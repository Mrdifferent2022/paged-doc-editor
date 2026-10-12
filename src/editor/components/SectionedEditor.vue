<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { Selection } from '@tiptap/pm/state';
import ContextMenu from 'primevue/contextmenu';
import LazySection from './LazySection.vue';
import EditorToolbar from './EditorToolbar.vue';
import CadEditorDialog from './CadEditorDialog.vue';
import { buildSection } from '../templates/standardTemplate.js';
import { mmToPx, paperSizeMm } from '../layout/pageLayout.js';

/**
 * 多节编辑器容器（包的主组件）：
 * - 顶部工具栏：**仅编辑态渲染**（只读态整条隐藏省窗口，用户 2026-08-28）；格式组作用于最近聚焦实例
 * - 节列表：每节独立纸张/方向/页眉页脚；屏外节靠 content-visibility:auto 跳过渲染（始终挂载，无卸载抖动）
 * - 插入节（任意纸张/方向，插在当前节之后）；纸张/方向/删节在右键菜单"页面设置"里（作用于被右键的节）
 * - 右键 ContextMenu：首项 编辑/只读 切换（request-edit 由宿主做权限校验）；编辑态多插入类 + 页面设置；
 *   任何状态都有 定版预览/导出 PDF/打印（emit 给宿主处理）
 * - 缩放：鼠标在页面正文时 Ctrl+滚轮缩放页面（CSS zoom，非浏览器缩放），emit update:zoom 由宿主持有
 *
 * 宿主应用用法：
 *   <SectionedEditor :sections="sections" v-model:zoom="zoom" :editable="editable" ref="ed"
 *       @request-edit="权限校验后 editable=true" @request-readonly="editable=false"
 *       @preview="..." @export-pdf="..." @print="..." />
 *   ed.getPayload() → [{ pageSize, orientation, header, footer, content }]  // 直接 POST 渲染服务
 *   ed.getScroll() / ed.setScroll({top,left})  // 滚动位置存取：宿主按文件持久化，重开文件时恢复（存取在宿主层）
 * - 水平自动居中：初始/resize/缩放/内容宽变化时纸张居中视口（即使右溢出）；用户手动横向滚动后让位
 */
const props = defineProps({
    sections: { type: Array, required: true }, // 宿主拥有并可直接修改（响应式数组）
    editable: { type: Boolean, default: true },
    zoom: { type: Number, default: 1 },
    visualPagination: { type: Boolean, default: true },
    exporting: { type: Boolean, default: false }, // 宿主导出中：导出按钮禁用 + 周圈进度环
    lang: { type: String, default: 'zh' }, // 文档语言（宿主传 doc.lang）：英文=Times 优先字体栈（根 class lang-en）+ 插节页眉页脚英文占位
    // 文档内部链接的相对路径前缀（默认 /open_doc_link/?openFile=<file_key>）——doc JSON 存相对形式不烘焙环境 base；
    // 渲染侧 render.js 用 docBaseUrl + 同名 docLinkPath 展开成绝对 URI（PDF link annotation 存活前提）
    docLinkPath: { type: String, default: '/open_doc_link/?openFile=' }
});
const emit = defineEmits(['preview', 'export-pdf', 'print', 'request-edit', 'request-readonly', 'update:zoom', 'request-doc-link', 'open-doc']);

// zoom 变化不触发编辑器事务——提供给深层浮动 UI（表格手柄等，Teleport 到悬浮层不受 CSS zoom 影响）做即时重定位/缩放
provide('pageZoom', () => props.zoom);
// 悬浮层（2026-09-22 穿透修复）：深层浮动 UI（表格手柄/图片工具条/裁剪框）统一 Teleport 目标。
// 原 Teleport 到 body + fixed + 钳 window 视口——编辑器 overflow 对它们零裁剪力，锚点横向滚出可视区后
// 手柄贴窗口左缘画到宿主左侧目录树上（云上实测）；悬浮层挂在 zoom 容器（.section-wrapper）与
// .sheet（content-visibility paint containment）之外、overflow:hidden 像素级裁剪，两个历史坑不踩
const floatingLayerEl = ref(null);
provide('floatingLayer', floatingLayerEl);
// 页眉/页脚子编辑器互通：
// - reportFocus：子编辑器聚焦时把自己报为工具栏目标（否则页眉里对齐/字体按钮作用于正文——"页眉文本不能居中"）
// - hfActive：编辑中的子编辑器注册自己（kind/parity/switchParity），右键菜单据此出"页眉/页脚设置"子菜单
const activeHf = shallowRef(null);
provide('reportFocus', (editor) => { activeEditor.value = editor; });
provide('hfActive', {
    register: (api) => { activeHf.value = api; },
    unregister: (api) => { if (activeHf.value === api) activeHf.value = null; }
});

const editorRefs = ref([]);
const activeEditor = shallowRef(null);
const activeIndex = ref(-1);

const onFocus = (i, editor) => {
    activeEditor.value = editor;
    activeIndex.value = i;
};

// 插入节：插在当前聚焦节之后（无聚焦则追加到末尾）；页眉页脚按文档语言生成（lang prop）
const insertSection = (preset) => {
    const at = activeIndex.value >= 0 ? activeIndex.value + 1 : props.sections.length;
    props.sections.splice(at, 0, buildSection({ ...preset, lang: props.lang }));
};

const patchSection = (id, patch) => {
    const s = props.sections.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
};

const removeSection = (id) => {
    if (props.sections.length <= 1) {
        alert('至少保留一节');
        return;
    }
    if (!window.confirm('删除本节内容？')) return;
    const i = props.sections.findIndex((x) => x.id === id);
    if (i >= 0) props.sections.splice(i, 1);
};

// ---- 右键菜单（Word/WPS 风格）：编辑态多插入类 + 页面设置（作用于被右键的节）；查看动作任何状态可用 ----
const cmRef = ref(null);
const cmSectionIdx = ref(-1); // 被右键的节（按事件冒泡路径上的 data-section-idx 定位）
const cmSection = computed(() => props.sections[cmSectionIdx.value] ?? null);
const cmInHf = ref(false); // 右键落在正在编辑的页眉/页脚里 → 菜单出"页眉/页脚设置"（奇偶页切换）
const cmPageNo = ref(-1); // 被右键页在被右键节内的页码（1 起；-1=定位失败，删除本页禁用）

// 删除本页（用户 2026-09-04）：删掉被右键页范围内的全部顶层块，文档至少保留一页（最后一页禁用）。
// 页范围 = VP 记下的块级页界 pageBounds 圈定（bounds[k-1]=第 k+1 页第一块的起始 pos）；
// 含 locked 字段的块（章节大标题 H1）跳过——与 LockedRegionGuard 同源判定，守卫不会再拦
const deletePage = (sec) => {
    const ed = editorRefs.value[cmSectionIdx.value]?.editor;
    const K = cmPageNo.value;
    if (!ed || ed.isDestroyed || K < 1) return;
    if (totalPages.value <= 1) {
        alert('文档至少保留一页');
        return;
    }
    const bounds = ed.storage.visualPagination?.pageBounds ?? [];
    if (K > bounds.length + 1) return; // 菜单打开瞬间 VP 又重算、页码过期——放弃
    const start = K === 1 ? 0 : bounds[K - 2];
    const end = K - 1 < bounds.length ? bounds[K - 1] : ed.state.doc.content.size;
    const ranges = [];
    ed.state.doc.forEach((node, offset) => {
        if (offset < start || offset >= end) return;
        let locked = false;
        node.descendants((child) => {
            if (child.type.name === 'field' && child.attrs.locked) {
                locked = true;
                return false;
            }
            return true;
        });
        if (!locked) ranges.push([offset, offset + node.nodeSize]);
    });
    if (!ranges.length) {
        alert('本页没有可删除的内容');
        return;
    }
    const globalNo = (pageOffsets.value[sec.id] ?? 0) + K;
    if (!window.confirm(`删除第 ${globalNo} 页的内容？`)) return;
    const tr = ed.state.tr;
    for (let i = ranges.length - 1; i >= 0; i--) tr.delete(ranges[i][0], ranges[i][1]);
    ed.view.dispatch(tr);
    // 尾部分页符清理：页界记账里分页符属于上一页，删其后一整页时分页符被留下 → 凭空多出一个空白尾页。
    // 文档以 [分页符] 或 [分页符+自动补的空段] 结尾时把分页符连带删掉（中间的分页符不碰——删中间页后下文顺移上页，分页符仍需要）
    const isEmptyP = (n) => n?.type.name === 'paragraph' && n.content.size === 0;
    while (ed.state.doc.childCount > 1) {
        const last = ed.state.doc.lastChild;
        const pb = last?.type.name === 'pageBreak' ? last : isEmptyP(last) && ed.state.doc.childCount > 2 && ed.state.doc.child(ed.state.doc.childCount - 2)?.type.name === 'pageBreak' ? ed.state.doc.child(ed.state.doc.childCount - 2) : null;
        if (!pb) break;
        const end = ed.state.doc.content.size;
        const pbEnd = last.type.name === 'pageBreak' ? end : end - last.nodeSize;
        ed.view.dispatch(ed.state.tr.delete(pbEnd - pb.nodeSize, pbEnd));
    }
    if (ed.state.doc.childCount === 0) ed.chain().insertContentAt(0, { type: 'paragraph' }).run(); // 保底：doc 不允许为空
    // 光标自动上移到上一页内容末尾（Selection.near 向后找可落点；落在锁定 H1 内会被守卫滤掉，保持原选区即可）
    try {
        const $to = ed.state.doc.resolve(Math.min(start, ed.state.doc.content.size));
        ed.view.dispatch(ed.state.tr.setSelection(Selection.near($to, -1)).scrollIntoView());
        ed.view.focus();
    } catch { /* 无有效落点保持原选区 */ }
};
const cmItems = computed(() => {
    const items = [];
    const sec = cmSection.value;
    // 当前值用 class 标记，CSS 把 ✓ 画在右端（label 左对齐整齐）
    const checked = (on) => (on ? 'cm-checked' : undefined);
    // 编辑/只读切换（原工具栏最左按钮，2026-08-28 挪入右键菜单；只读态工具栏整条隐藏，这是唯一入口）
    items.push(
        props.editable
            ? { label: '切换为只读', icon: 'pi pi-lock-open', command: () => emit('request-readonly') }
            : { label: '进入编辑', icon: 'pi pi-lock', command: () => emit('request-edit') },
        { separator: true }
    );
    // 页眉/页脚编辑中的右键：奇偶页设置（数据源 = 子编辑器注册的 hfApi；编辑条上没有任何按钮）
    const hf = cmInHf.value ? activeHf.value : null;
    if (hf) {
        items.push(
            {
                label: `${hf.kind === 'header' ? '页眉' : '页脚'}设置`,
                icon: 'pi pi-cog',
                items: [
                    { label: '奇数页', class: checked(hf.parity() === 'odd'), command: () => hf.switchParity('odd') },
                    { label: '偶数页', class: checked(hf.parity() === 'even'), command: () => hf.switchParity('even') }
                ]
            },
            { separator: true }
        );
    }
    if (props.editable) {
        items.push(
            { label: '插入分页符', icon: 'pi pi-minus', command: () => activeEditor.value?.chain().focus().insertPageBreak().run() },
            { label: '插入表格', icon: 'pi pi-table', command: () => activeEditor.value?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
            // 文档内部链接：emit 请宿主弹标准/章节选择对话框，宿主确认后回调 applyDocLink（作用于被右键节的编辑器）
            { label: '插入文档链接', icon: 'pi pi-link', command: () => emit('request-doc-link') },
            ...(cmOnLink.value
                ? [{ label: '移除链接', icon: 'pi pi-minus', class: 'cm-danger', command: () => cmEditor.value?.chain().setTextSelection(cmLinkPos.value).unsetLink().run() }]
                : []),
            { separator: true }
        );
        if (sec) {
            items.push(
                {
                    label: `页面设置（${sec.pageSize} ${sec.orientation === 'landscape' ? '横向' : '纵向'}）`,
                    icon: 'pi pi-file',
                    items: [
                        { label: 'A4', class: checked(sec.pageSize === 'A4'), command: () => patchSection(sec.id, { pageSize: 'A4' }) },
                        { label: 'A3', class: checked(sec.pageSize === 'A3'), command: () => patchSection(sec.id, { pageSize: 'A3' }) },
                        { separator: true },
                        { label: '纵向', class: checked(sec.orientation === 'portrait'), command: () => patchSection(sec.id, { orientation: 'portrait' }) },
                        { label: '横向', class: checked(sec.orientation === 'landscape'), command: () => patchSection(sec.id, { orientation: 'landscape' }) }
                    ]
                },
                { label: '删除本页', icon: 'pi pi-times', class: 'cm-danger', disabled: totalPages.value <= 1 || cmPageNo.value < 1, command: () => deletePage(sec) },
                { label: '删除本节', icon: 'pi pi-trash', class: 'cm-danger', disabled: props.sections.length <= 1, command: () => removeSection(sec.id) },
                { separator: true }
            );
        }
    }
    items.push(
        { label: '定版预览', icon: 'pi pi-eye', command: () => emit('preview') },
        { label: props.exporting ? '导出中…' : '导出 PDF', icon: 'pi pi-download', disabled: props.exporting, command: () => emit('export-pdf') },
        { label: '打印', icon: 'pi pi-print', command: () => emit('print') }
    );
    return items;
});
const onContextMenu = (e) => {
    const holder = e.target?.closest?.('[data-section-idx]');
    cmSectionIdx.value = holder ? Number(holder.dataset.sectionIdx) : -1;
    cmInHf.value = !!e.target?.closest?.('.hf-editor.hf-editing'); // 右键落在编辑中的页眉/页脚里
    // 定位被右键的页：鼠标坐标 → 文档位置 → 按 VP 页界数页码（页界=新页第一块起始 pos，b<=pos 即落在其后页）。
    // 坐标先钳进正文盒：点在页边距/页间隙等非正文区（posAtCoords 返回 null）也能按同一高度定位到最近块
    cmPageNo.value = -1;
    cmOnLink.value = false;
    cmLinkPos.value = null;
    const ed = cmSectionIdx.value >= 0 ? editorRefs.value[cmSectionIdx.value]?.editor : null;
    cmEditor.value = ed && !ed.isDestroyed ? ed : null;
    if (ed && !ed.isDestroyed) {
        const rect = ed.view.dom.getBoundingClientRect();
        const x = Math.min(Math.max(e.clientX, rect.left + 2), rect.right - 2);
        const y = Math.min(Math.max(e.clientY, rect.top + 2), rect.bottom - 2);
        const pos = ed.view.posAtCoords({ left: x, top: y })?.pos;
        if (pos != null) {
            const bounds = ed.storage.visualPagination?.pageBounds ?? [];
            cmPageNo.value = 1 + bounds.filter((b) => b <= pos).length;
            // 右键点是否落在已有 link mark 上（"移除链接"菜单项判定；unsetLink 内部 extendMarkRange 整段移除）
            cmOnLink.value = ed.state.doc.resolve(pos).marks().some((mk) => mk.type.name === 'link');
            cmLinkPos.value = pos;
        }
    }
    cmRef.value?.show(e);
};

// ---- 文档内部链接：href 存相对形式 <docLinkPath><file_key>（doc JSON 单一事实源不烘焙环境 base；
//      渲染侧 render.js 用 docBaseUrl 展开成绝对 URI——PDF link annotation 经 pdf-lib copyPages 存活的前提是外部绝对 URI；
//      PDF 里点击由宿主 open_doc_link 端点 302 到目标文档 PDF，新 tab 直开不重载应用）。
//      插入走右键菜单"插入文档链接"→ emit request-doc-link 请宿主弹选择对话框 → 宿主回填调 applyDocLink；
//      点击走 <main> @click 拦截（onMainClick，编辑/只读两态单击即开）→ emit open-doc 由宿主 openFileByKey 打开 ----
const docLinkHref = (fileKey) => `${props.docLinkPath}${encodeURIComponent(fileKey)}`;
const cmEditor = shallowRef(null); // 被右键节的编辑器（右键不聚焦 ProseMirror，activeEditor 可能还指着旧节）
const cmOnLink = ref(false); // 右键位置是否落在已有 link mark 上 → 菜单出"移除链接"
const cmLinkPos = ref(null);
const applyDocLink = ({ fileKey, label }) => {
    const ed = cmEditor.value ?? activeEditor.value;
    if (!ed || ed.isDestroyed) return false;
    const href = docLinkHref(fileKey);
    const chain = ed.chain().focus();
    if (ed.state.selection.empty) {
        // 无选区：插入目标文件显示名作为链接文字；自动加粗（用户拍板，普通 bold mark，工具栏可随时改回）
        chain.insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }, { type: 'bold' }] }).run();
    } else {
        // 已有选区：只挂 link，不动用户已有排版（不强制 bold）
        chain.setLink({ href }).run();
    }
    return true;
};
// 链接点击拦截（DOM 事件委托，一处覆盖所有节/子编辑器——页眉页脚预览是 v-html 不走 PM handleClick）：
// 编辑/只读两态单击即开（2026-09-09 二轮拍板；mousedown 不动，编辑态光标放置行为不受影响）
const onMainClick = (e) => {
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    const m = (a.getAttribute('href') || '').match(/[?&]openFile=([^&]+)/);
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    emit('open-doc', decodeURIComponent(m[1]));
};

// ---- CAD 图纸弹窗（2026-09-23）：双击占位区打开，DOM 事件委托定位（与 onMainClick 同款定式）----
// NodeView 不设双击监听——cadDrawing 无 NodeView，renderHTML 输出的 [data-cad-drawing]
// 冒泡到 <main> 统一拦截：closest 定位节编辑器 + posAtCoords 找节点位置，弹窗写回走 setNodeMarkup
const cadDialogRef = ref(null);
const onMainDblclick = (e) => {
    if (!e.target?.closest?.('[data-cad-drawing]')) return;
    const holder = e.target.closest('[data-section-idx]');
    const ed = holder ? editorRefs.value[Number(holder.dataset.sectionIdx)]?.editor : null;
    if (!ed || ed.isDestroyed) return;
    const rect = ed.view.dom.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX, rect.left + 2), rect.right - 2);
    const y = Math.min(Math.max(e.clientY, rect.top + 2), rect.bottom - 2);
    const pos = ed.view.posAtCoords({ left: x, top: y })?.pos;
    if (pos == null) return;
    // atom 节点的 posAtCoords 落点在节点前/后——两个候选位都试
    let cadPos = null;
    for (const cand of [pos, pos - 1]) {
        const n = cand >= 0 ? ed.state.doc.nodeAt(cand) : null;
        if (n?.type.name === 'cadDrawing') { cadPos = cand; break; }
    }
    if (cadPos == null) return;
    e.preventDefault(); // 压掉 PM 双击选词（atom 上是选节点，无害但避免选区闪烁）
    cadDialogRef.value?.open({ editor: ed, pos: cadPos });
};

// ---- Ctrl+滚轮缩放：鼠标在页面正文上时缩放页面（CSS zoom），不触发浏览器整页缩放 ——
// passive:false 才能 preventDefault；触控板捏合手势也以 ctrl+wheel 上报，一并支持
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const sectionsEl = ref(null);
const onWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    userZoomed = true; // 用户手动缩放 → 自适应让位
    const next = Math.round((props.zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)) * 10) / 10;
    emit('update:zoom', Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
};
onMounted(() => sectionsEl.value?.addEventListener('wheel', onWheel, { passive: false }));
onBeforeUnmount(() => sectionsEl.value?.removeEventListener('wheel', onWheel));

// ---- 自适应缩放：加载/窗口变化时若首屏纸张比视口宽，自动降到合适比例（页宽贴视口，如小屏 60%~70%）；
//      用户 ctrl+滚轮或宿主改 zoom 后即让位，不再自动调整 ----
let userZoomed = false;
let lastFitEmit = null; // 自己 emit 出去的拟合值，用于区分"宿主/用户主动改 zoom"
const fitZoom = () => {
    const el = sectionsEl.value;
    const first = props.sections[0];
    if (!el || !first) return;
    const { w } = paperSizeMm(first.pageSize, first.orientation);
    const fit = Math.floor(((el.clientWidth - 32) / mmToPx(w)) * 100) / 100; // 留 32px 灰边
    const next = Math.min(1, Math.max(ZOOM_MIN, fit)); // 只降不升：大屏保持 100%
    if (Math.abs(next - props.zoom) < 0.01) return;
    lastFitEmit = next;
    emit('update:zoom', next);
};
watch(
    () => props.zoom,
    (z) => {
        if (lastFitEmit != null && Math.abs(z - lastFitEmit) < 0.001) return; // 自己发的拟合值被宿主接收
        userZoomed = true; // 宿主下拉/外部改动 → 让位
    }
);

// ---- 水平自动居中：初始/窗口 resize/缩放/插节导致内容宽变化时，把纸张居中到视口（即使右溢出）；
//      用户一旦手动横向滚动（横向滚轮/触控板横移/拖滚动条/触屏/方向键）即让出控制权，不再抢 ----
let userControlX = false;
let centerRO = null;
const centerH = () => {
    const el = sectionsEl.value;
    if (!el) return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
};
onMounted(() => {
    const el = sectionsEl.value;
    if (!el) return;
    const takeControl = () => { userControlX = true; };
    // 只把"明确的横向输入"视为用户接管：纵向滚轮/纵向滚动不影响自动居中
    el.addEventListener('wheel', (e) => { if (!e.ctrlKey && (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey)) takeControl(); }, { passive: true });
    el.addEventListener('pointerdown', (e) => { if (e.target === el && (e.offsetY > el.clientHeight || e.offsetX > el.clientWidth)) takeControl(); }, true); // 滚动条轨道
    el.addEventListener('touchstart', takeControl, { passive: true });
    el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') takeControl(); });
    // 视口宽变化 → 未被接管时重新居中 + 未被接管缩放时重新拟合；内容宽变化（插节/改纸张）→ 仅居中
    centerRO = new ResizeObserver(() => { if (!userControlX) centerH(); if (!userZoomed) fitZoom(); });
    centerRO.observe(el);
    const innerRO = new ResizeObserver(() => { if (!userControlX) centerH(); });
    innerRO.observe(el.querySelector('.sections-inner'));
    centerRO._inner = innerRO;
    fitZoom(); // 加载即拟合（小屏首屏 60%~70%）
    centerH();
});
onBeforeUnmount(() => { centerRO?.disconnect(); centerRO?._inner?.disconnect(); });

// ---- 全局页码聚合：各节 VP 重算后上报本节页数 → 前缀和算出每节的全局页码偏移与总页数，
//      回传给 LazySection → SectionEditor → VP（getPageOffset）→ 页间隙/页眉页脚条显示跨节连续页码 ----
const sectionPages = ref({}); // { [sectionId]: pages }
const onSectionPages = (id, pages) => {
    if (sectionPages.value[id] !== pages) sectionPages.value = { ...sectionPages.value, [id]: pages };
};
const pageOffsets = computed(() => {
    let acc = 0;
    const map = {};
    for (const s of props.sections) {
        map[s.id] = acc;
        acc += sectionPages.value[s.id] ?? 1;
    }
    return map;
});
const totalPages = computed(() =>
    props.sections.reduce((sum, s) => sum + (sectionPages.value[s.id] ?? 1), 0)
);

// 滚动位置 API：宿主按文件持久化（localStorage/后端），关闭再打开时恢复——存取本身在宿主层实现
const getScroll = () => ({ top: sectionsEl.value?.scrollTop ?? 0, left: sectionsEl.value?.scrollLeft ?? 0 });
const setScroll = (p = {}) => {
    const el = sectionsEl.value;
    if (!el) return;
    userControlX = true; // 恢复的是用户上次的位置，自动居中让位
    if (p.top != null) el.scrollTop = p.top;
    if (p.left != null) el.scrollLeft = p.left;
};

// 取全文档负载（编辑中的节取编辑器实时 JSON，未挂载的节取原 content；奇偶页眉页脚/边距覆盖一并带出）
const getPayload = () =>
    props.sections.map((s, i) => ({
        pageSize: s.pageSize,
        orientation: s.orientation,
        marginsMm: s.marginsMm,
        bodyPadMm: s.bodyPadMm,
        header: s.header,
        headerEven: s.headerEven,
        footer: s.footer,
        footerEven: s.footerEven,
        content: editorRefs.value[i]?.getJSON()?.content ?? s.content
    }));

// 取完整节数据（含 id 与全部字段，实时内容合并）——宿主持久化用（存 .json 后可原样喂回 :sections）
const getSections = () =>
    props.sections.map((s, i) => ({
        ...s,
        content: editorRefs.value[i]?.getJSON()?.content ?? s.content
    }));

defineExpose({ getPayload, getSections, getScroll, setScroll, applyDocLink });
</script>

<template>
    <EditorToolbar v-if="editable" :editor="activeEditor" :lang="lang" @insert-section="insertSection" />
    <!-- 滚动容器壳：relative 给悬浮层做定位锚；flex 链保持 min-height:0（长文档不顶高父级） -->
    <div class="sections-shell">
        <main ref="sectionsEl" class="sections" :class="{ 'lang-en': lang === 'en' }" @contextmenu="onContextMenu" @click="onMainClick" @dblclick="onMainDblclick">
            <!-- 内层容器：max-content 让滚动内容宽=最宽纸张，所有节在同一内容中轴线上居中
                 （否则节各自按可见容器宽居中：宽节两侧溢出、左溢出永远滚不到；横向滚动后窄节提前滚出视口被懒卸载成空白） -->
            <div class="sections-inner">
                <LazySection
                    v-for="(s, i) in sections"
                    :key="s.id"
                    :ref="(el) => (editorRefs[i] = el)"
                    :section="s"
                    :editable="editable"
                    :zoom="zoom"
                    :visual-pagination="visualPagination"
                    :page-offset="pageOffsets[s.id] ?? 0"
                    :page-total="totalPages"
                    :data-section-idx="i"
                    @focus="(e) => onFocus(i, e)"
                    @section-patch="patchSection"
                    @section-pages="onSectionPages"
                />
            </div>
        </main>
        <!-- 悬浮层：浮动 UI 统一 Teleport 到此，出编辑器可视区即被裁断（pointer-events 由子元素各自恢复） -->
        <div ref="floatingLayerEl" class="floating-layer"></div>
    </div>
    <ContextMenu ref="cmRef" :model="cmItems" />
    <!-- CAD 图纸编辑弹窗：双击占位区（onMainDblclick 委托）打开；编辑/只读两态都可查看，写回按 editable 闸 -->
    <CadEditorDialog ref="cadDialogRef" />
</template>
