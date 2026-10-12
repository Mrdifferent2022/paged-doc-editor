<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { buildExtensions } from '../tiptap/index.js';
import { VisualPagination } from '../tiptap/VisualPagination.js';
import { ActiveCell } from '../tiptap/activeCell.js';
import { usePageLayout } from '../layout/usePageLayout.js';
import { renderGap, renderTail } from '../layout/gapFurniture.js';
import { resolveStories } from '../layout/stories.js';
import TableFloatingMenu from './TableFloatingMenu.vue';
import ImageFloatingMenu from './ImageFloatingMenu.vue';
import HeaderFooterEditor from './HeaderFooterEditor.vue';

/**
 * 单节编辑器（组装者）：纸张宽度 + 页边距的居中白纸。
 * - 几何全部来自 usePageLayout（computePageLayout 引擎输出）：sheet 尺寸/padding、
 *   VP 的 pageH/间隙家具高、页脚条定位——与 render-server 打印侧同源，不可能漂移。
 * - 视觉分页：自研 VisualPagination 插件（块级间隙装饰），写满一页自动出现下一页；
 *   间隙家具由 layout/gapFurniture.js 纯工厂建造（含奇偶页页眉页脚选取）。
 * - 页眉/页脚：HeaderFooterEditor 子编辑器（双击原位富文本编辑，Esc/点外部保存）；
 *   RO 报高 → 有效边距自动撑高（Word 同款，正文随之推移），与打印侧测量前置同回路。
 */
const props = defineProps({
    section: { type: Object, required: true }, // { id, pageSize, orientation, marginsMm?, header, headerEven?, footer, footerEven?, headerEditable, footerEditable, content }
    editable: { type: Boolean, default: true },
    zoom: { type: Number, default: 1 },
    visualPagination: { type: Boolean, default: true }, // kill switch：分页异常时关掉即回纯连续流
    pageOffset: { type: Number, default: 0 }, // 全局页码偏移（前序各节页数之和，由 SectionedEditor 聚合）
    pageTotal: { type: Number, default: 0 } // 全文总页数（{pages} 占位显示）
});

const emit = defineEmits(['focus', 'section-patch', 'section-pages']);

// 页眉/页脚实测高（子编辑器 RO 上报）→ 引擎自动撑高回路
const headerHeightPx = ref(0);
const footerHeightPx = ref(0);
const layout = usePageLayout(() => props.section, headerHeightPx, footerHeightPx);

const sheetStyle = computed(() => {
    const l = layout.value;
    return {
        width: l.paperPx.w + 'px',
        minHeight: l.paperPx.h + 'px',
        padding: `${l.marginsPx.top}px ${l.marginsPx.right}px ${l.marginsPx.bottom}px ${l.marginsPx.left}px`,
        // 屏外渲染优化（替代旧懒挂载）：浏览器跳过屏外节的布局/绘制，DOM/编辑器状态全保留。
        // contain-intrinsic-size 给首渲前估算尺寸（单页纸宽×高），auto 让浏览器渲过之后记住真实尺寸——
        // 尺寸在 sheet 自身坐标系（zoom 之前），天然与缩放无关，滚动条高度全程稳定。
        // 注意只能放 .sheet 不能放 holder/.section-wrapper：content-visibility 自带 paint containment，
        // 会把 TableFloatingMenu/ImageFloatingMenu 里 position:fixed 的手柄/裁剪框改成相对它定位并裁剪。
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${l.paperPx.w}px auto ${l.paperPx.h}px`
    };
});

// 间隙家具的奇偶选取：页脚属于上一页、页眉属于下一页，各自按全局页码奇偶选变体
const buildGap = (nextPageNo, fillPx = 0) =>
    renderGap({
        layout: layout.value,
        footerHtml: resolveStories(props.section, nextPageNo - 1).footer,
        headerHtml: resolveStories(props.section, nextPageNo).header,
        nextPageNo,
        totalPages: props.pageTotal,
        fillPx
    });

const ownPages = ref(1); // 本节页数（VP 重算后回传，上报父组件聚合全局页码）

// 间隙家具内容指纹：页眉页脚 HTML / 总页数变了，即使 pos/fill 没变，VP widget key 也必须变，
// 否则 PM 复用旧 DOM（坑 #23 推广）——间隙条冻结在旧页眉页脚上
const hfContentKey = () => {
    const s = props.section;
    const str = `${s.header ?? ''}|${s.headerEven ?? ''}|${s.footer ?? ''}|${s.footerEven ?? ''}|${props.pageTotal}`;
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0; // djb2 简版
    return h.toString(36);
};

const editor = useEditor({
    editable: props.editable,
    content: { type: 'doc', content: props.section.content },
    extensions: [
        ...buildExtensions(),
        ActiveCell, // 纯视图装饰：光标所在单元格高亮（不进 JSON）
        VisualPagination.configure({
            enabled: props.visualPagination,
            // 一页可用内容高/间隙家具高全部读引擎（= Chromium 打印内容区，编辑/打印分页点逐像素对齐）。
            // 全程 zoom 坐标系（不乘 zoom!）：Chrome CSS zoom 下容器内元素的 offsetHeight 是未缩放值（坑 #35）
            getPageContentHeight: () => layout.value.pageContentHeightPx,
            // 全局页码偏移（跨节连续编号）：本节第一页 = 1 + pageOffset
            getPageOffset: () => props.pageOffset,
            getGapHeight: () => layout.value.gapHeightPx,
            // 间隙家具内容指纹（页眉页脚改了即使几何没变也要重画间隙条，坑 #23 推广）
            getGapContentKey: hfContentKey,
            // 重算完成：更新本节页数并上报父组件（聚合出其他节的 pageOffset 与本节 pageTotal）
            onComputed: (pages) => {
                if (pages === ownPages.value) return;
                ownPages.value = pages;
                emit('section-pages', props.section.id, pages);
            },
            renderGap: buildGap,
            renderTail
        })
    ],
    onFocus: () => emit('focus', editor.value),
    onCreate: () => {
        window.__eds = window.__eds || {};
        window.__eds[props.section.id] = editor.value;
    }
});

watch(
    () => props.editable,
    (val) => editor.value?.setEditable(val)
);

// 几何（页眉页脚撑高/纸张属性）/ 页眉页脚内容（签章回填）/ zoom / 页码偏移变化 → 重算视觉分页。
// 须等 DOM 更新后再重算：sheet padding 与条高都已按新 layout 落到 DOM。
watch(
    () => [
        props.zoom,
        props.pageOffset,
        props.section.header, props.section.headerEven, props.section.footer, props.section.footerEven,
        layout.value.pageContentHeightPx, layout.value.gapHeightPx,
        layout.value.paperPx.w, layout.value.paperPx.h
    ],
    async () => {
        await nextTick();
        editor.value?.storage.visualPagination?.refresh();
    }
);

// 视觉分页开关（kill switch）：直接改插件 options 并强制重算
watch(
    () => props.visualPagination,
    (val) => {
        const ed = editor.value;
        if (!ed) return;
        const ext = ed.extensionManager.extensions.find((e) => e.name === 'visualPagination');
        if (ext) ext.options.enabled = val;
        ed.storage.visualPagination?.refresh();
    }
);

// 子编辑器保存（奇/偶变体都在 patch 里）→ 透传父组件写回 section
const onHfSave = (patch) => emit('section-patch', props.section.id, patch);

// 节级页眉/页脚锁（2026-08-25 用户拍板：模板版式由模板维护，文档实例只经传参/签章驱动）。
// 此前 headerEditable/footerEditable 只写在 prop 注释里没人消费——双击照样进编辑（2026-08-28 用户踩到：
// 页脚退编辑后丢类变左对齐）。现在真正接管：锁定即不可进编辑（sheet 条/间隙条浮层/缺省插入提示三处同源）
const headerEditable = computed(() => props.editable && props.section.headerEditable !== false);
const footerEditable = computed(() => props.editable && props.section.footerEditable !== false);

// 页间隙条是静态预览装饰（页眉页脚只有"一个故事"，每页重复的只是展示），但用户会直觉双击任意一页的
// 页眉/页脚 → 原位浮层编辑：在该条正上方罩一个 HeaderFooterEditor（startEditing 挂载即进编辑），
// 按本条页码奇偶直接打开对应变体（data-hf-parity，页眉=下一页、页脚=上一页），不再跳转到 sheet 顶/底条。
// 浮层不监听 @resize：编辑期间不触发几何重算（间隙装饰重绘会毁掉锚点），保存提交后由 sheet 条 RO/内容指纹统一刷新。
const headerEdRef = ref(null);
const footerEdRef = ref(null);
const sheetEl = ref(null);
const gapEdit = ref(null); // { kind, parity, top } —— 打开中的间隙条原位编辑浮层
const gapEditRef = ref(null);
const onBodyDblclick = (e) => {
    if (!props.editable) return;
    const gapHf = e.target.closest('.vp-gap-header, .vp-gap-footer');
    if (!gapHf || !sheetEl.value) return;
    const kind = gapHf.classList.contains('vp-gap-header') ? 'header' : 'footer';
    if (kind === 'header' ? !headerEditable.value : !footerEditable.value) return; // 节级锁：间隙条浮层同源
    // rect 是缩放后屏幕坐标，除以实测 zoom 回到 sheet 布局坐标系（坑 #35 同口径）
    const zoomF = sheetEl.value.offsetWidth > 0 ? sheetEl.value.getBoundingClientRect().width / sheetEl.value.offsetWidth : 1;
    const top = (gapHf.getBoundingClientRect().top - sheetEl.value.getBoundingClientRect().top) / (zoomF || 1);
    gapEdit.value = { kind, parity: gapHf.dataset.hfParity, top };
};
// 缩放变化 → 间隙装饰必然重绘（锚点失效），先保存再关浮层
watch(
    () => props.zoom,
    () => {
        if (gapEdit.value) { gapEditRef.value?.commit(); gapEdit.value = null; }
    }
);
const onGapClosed = () => { gapEdit.value = null; };

// 页眉/页脚缺省：双击悬停提示区插入空带并立即进入编辑（带高随内容自动撑高，模型支持无带）
const insertHf = async (kind) => {
    if (kind === 'header' ? !headerEditable.value : !footerEditable.value) return; // 节级锁：缺省插入提示同源
    emit('section-patch', props.section.id, { [kind]: '<p><br></p>' });
    await nextTick();
    (kind === 'header' ? headerEdRef : footerEdRef).value?.enterEdit();
};

// 供父组件取 JSON（导出/定版渲染用）
const getJSON = () => editor.value?.getJSON();
defineExpose({ getJSON, editor });

onBeforeUnmount(() => editor.value?.destroy());
</script>

<template>
    <div class="section-wrapper" :style="{ zoom }">
        <div class="sheet" ref="sheetEl" :style="sheetStyle">
            <div
                v-if="section.header || section.headerEven"
                class="sheet-hf sheet-header"
                :style="{ left: layout.marginsPx.left + 'px', right: layout.marginsPx.right + 'px', top: layout.headerBarTopCss }"
            >
                <HeaderFooterEditor
                    ref="headerEdRef"
                    kind="header" :section="section" :editable="headerEditable"
                    :page-no="pageOffset + 1" :page-total="pageTotal"
                    @save="onHfSave" @resize="(h) => (headerHeightPx = h)"
                />
            </div>
            <!-- 页眉缺省：悬停提示区（占满上边距合成区，不与正文抢点击），双击插入空带并直接进编辑 -->
            <div
                v-else-if="headerEditable"
                class="sheet-hf sheet-hf-hint"
                :style="{ left: layout.marginsPx.left + 'px', right: layout.marginsPx.right + 'px', top: 0, height: layout.marginsPx.top + 'px' }"
                @dblclick="insertHf('header')"
            >
                <span>＋ 双击添加页眉</span>
            </div>
            <EditorContent :editor="editor" class="section-editor" @dblclick="onBodyDblclick" />
            <!-- 间隙条原位编辑浮层：罩在被双击的页眉/页脚条正上方（sheet 坐标系，随 zoom 自然缩放），
                 编辑的数据与 sheet 顶/底条同源（section.header/headerEven/footer/footerEven），保存后所有页同步 -->
            <div
                v-if="gapEdit"
                class="hf-gap-edit"
                :style="{
                    top: gapEdit.top + 'px',
                    left: layout.marginsPx.left + 'px',
                    width: layout.paperPx.w - layout.marginsPx.left - layout.marginsPx.right + 'px'
                }"
            >
                <HeaderFooterEditor
                    ref="gapEditRef"
                    :kind="gapEdit.kind" :section="section" :editable="gapEdit.kind === 'header' ? headerEditable : footerEditable"
                    :page-total="pageTotal"
                    start-editing :start-parity="gapEdit.parity"
                    @save="onHfSave" @closed="onGapClosed"
                />
            </div>
            <div
                v-if="section.footer || section.footerEven"
                class="sheet-hf sheet-footer"
                :style="{
                    left: layout.marginsPx.left + 'px',
                    right: layout.marginsPx.right + 'px',
                    top: layout.footerBarTopCss
                }"
            >
                <HeaderFooterEditor
                    ref="footerEdRef"
                    kind="footer" :section="section" :editable="footerEditable"
                    :page-no="pageOffset + ownPages" :page-total="pageTotal"
                    @save="onHfSave" @resize="(h) => (footerHeightPx = h)"
                />
            </div>
            <!-- 页脚缺省：悬停提示区（钉纸底方向），双击插入空带并直接进编辑 -->
            <div
                v-else-if="footerEditable"
                class="sheet-hf sheet-hf-hint"
                :style="{ left: layout.marginsPx.left + 'px', right: layout.marginsPx.right + 'px', bottom: 0, height: layout.marginsPx.bottom + 'px' }"
                @dblclick="insertHf('footer')"
            >
                <span>＋ 双击添加页脚</span>
            </div>
        </div>
        <TableFloatingMenu v-if="editor" :editor="editor" />
        <ImageFloatingMenu v-if="editor" :editor="editor" :zoom="zoom" />
    </div>
</template>
