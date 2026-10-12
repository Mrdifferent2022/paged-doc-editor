<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Editor } from '@tiptap/vue-3';
import { buildExtensions } from '../tiptap/index.js';
import { resolveStories, fillHfPreview, blankPendingHfFields } from '../layout/stories.js';
import TableFloatingMenu from './TableFloatingMenu.vue';
import ImageFloatingMenu from './ImageFloatingMenu.vue';

/**
 * 页眉/页脚子编辑器（Word 同款原位编辑，无对话框）：
 * - 预览态：静态 HTML（真实全局页码占位替换），双击进入编辑态；
 * - 编辑态：懒创建完整 Tiptap 子编辑器（buildExtensions 全量——表格行列/合并/列宽与正文同款，
 *   不含 VisualPagination/ActiveCell 这两个正文专用视图插件）；**无任何编辑条/提示文字**；
 * - 奇偶变体：模板含 even 变体（headerEven/footerEven）时，**右键菜单**里出"页眉/页脚设置"子菜单
 *   （奇数页/偶数页，当前项右侧 ✓——由 SectionedEditor 的 ContextMenu 提供，经 hfActive 注入互通）；
 * - Esc 或点击外部 → getHTML 保存（emit save），回到预览态；
 * - 聚焦时把自己上报为主工具栏的目标编辑器（reportFocus 注入）——否则页眉里打字时
 *   工具栏的居中/对齐等按钮仍作用于正文编辑器（表现为"页眉文本不能居中"）；
 * - ResizeObserver 监听内容高 → emit resize（父组件据此自动撑高边距，正文随之推移）。
 */
const props = defineProps({
    kind: { type: String, required: true }, // 'header' | 'footer'
    section: { type: Object, required: true },
    editable: { type: Boolean, default: true },
    pageNo: { type: Number, default: null }, // 预览填充的全局页码（null → 占位符号）
    pageTotal: { type: Number, default: 0 },
    // 浮层模式（SectionEditor 的 .hf-gap-edit 用）：挂载即进编辑态，commit 后 emit closed 由父组件卸载
    startEditing: { type: Boolean, default: false },
    startParity: { type: String, default: null } // 'odd' | 'even' | null（null → 按 pageNo 推导）
});
const emit = defineEmits(['save', 'resize', 'closed']);

const mode = ref('preview'); // 'preview' | 'edit'
const parity = ref('odd'); // 编辑中的变体（预览永远按 pageNo 奇偶显示）
const drafts = {}; // { odd?, even? } 本次编辑会话的未提交稿
const rootEl = ref(null);
const previewEl = ref(null);
const editEl = ref(null);
const subEditor = shallowRef(null);

const evenKey = computed(() => `${props.kind}Even`);
const hasEven = computed(() => !!props.section[evenKey.value]);
const htmlFor = (p) =>
    p === 'even' ? props.section[evenKey.value] || props.section[props.kind] || '' : props.section[props.kind] || '';

// 与 SectionedEditor 互通（inject，宿主外层必有）：
// - reportFocus：子编辑器聚焦时上报，主工具栏（对齐/字体等）才能作用于页眉页脚内容
// - hfActive：编辑中注册自己 → 右键菜单出"页眉/页脚设置"（奇偶页切换，当前项 ✓）
const reportFocus = inject('reportFocus', null);
const hfActive = inject('hfActive', null);
// 右键菜单读的 api（parity 是 getter，菜单 computed 里调用即被 Vue 依赖追踪，✓ 实时跟随）
const hfApi = { kind: props.kind, parity: () => parity.value, switchParity: (p) => switchParity(p) };

// 预览：按本页全局页码的奇偶选变体 + 占位替换（页脚在末页条、页眉在首页条，页码由父组件给）
const previewHtml = computed(() => {
    const story = resolveStories(props.section, props.pageNo || 1)[props.kind];
    // 页脚占位字段置空显示：只隐藏 {{...}} 本体，标签与灰线照常（签章后字段回填自然现身）；
    // 行高由 .foot-line 钉死 → 置空与回填带高相同。页眉占位短，不置空
    const html = props.kind === 'footer' ? blankPendingHfFields(story) : story;
    return fillHfPreview(html, props.pageNo, props.pageTotal);
});

// ---- 编辑态生命周期 ----
// opts.parity：进入时直接打开指定变体（间隙条双击代理按本条页码奇偶传入）；
// 缺省按本条的 pageNo 奇偶决定（sheet 条：页眉=节首页、页脚=节末页，可能是全局偶数页）
const enterEdit = async (opts = {}) => {
    if (!props.editable || mode.value === 'edit') return;
    rootEl.value?.scrollIntoView({ block: 'nearest' }); // 间隙条双击代理进来时，真实条可能屏外
    mode.value = 'edit';
    const want = opts.parity ?? (props.pageNo && props.pageNo % 2 === 0 ? 'even' : 'odd');
    const start = hasEven.value && want === 'even' ? 'even' : 'odd';
    delete drafts.odd;
    delete drafts.even;
    drafts[start] = htmlFor(start);
    parity.value = start;
    await nextTick();
    subEditor.value = new Editor({
        element: editEl.value,
        extensions: buildExtensions({ structuralParagraph: false }), // 页眉页脚的 hf-title/foot-contacts 表本就是末尾节点，补段会撑高带
        content: drafts[start],
        editable: true,
        autofocus: 'end',
        onFocus: () => reportFocus?.(subEditor.value), // 工具栏（对齐/字体/插表）作用于本子编辑器
        editorProps: {
            handleKeyDown: (_view, event) => {
                if (event.key === 'Escape') { commit(); return true; }
                return false;
            }
        }
    });
    if (hasEven.value) hfActive?.register(hfApi); // 右键菜单"页眉/页脚设置"（奇偶切换）的数据源
    // 调试钩子（与 window.__eds 同款）：无头脚本驱动子编辑器用
    window.__hfs = window.__hfs || {};
    window.__hfs[`${props.section.id}:${props.kind}`] = subEditor.value;
    document.addEventListener('mousedown', onDocMousedown, true);
};

const onDocMousedown = (e) => {
    if (rootEl.value?.contains(e.target)) return;
    // 右键（button=2）不退出：右键要弹 ContextMenu（含"页眉/页脚设置"），退出编辑菜单就无的放矢
    if (e.button !== 0) return;
    // 子编辑器的浮动 UI 与主工具栏都在 rootEl 之外（Teleport/独立区域），点它们不算"点击外部"——
    // 否则编辑态点一下右键菜单/单元格手柄/工具栏居中按钮就误退出保存（命令目标编辑器已销毁，操作落空）
    if (
        e.target.closest(
            '.cell-handle, .table-handle, .p-tieredmenu-overlay, .p-menu-overlay, .p-contextmenu, .p-select-overlay, .p-colorpicker-overlay, .img-menu, .crop-frame, .crop-win, .crop-handle, .format-bar'
        )
    )
        return;
    commit();
};

// 奇/偶切换：当前稿存进 drafts，载入另一变体（even 缺省回退 odd 稿的初值）
const switchParity = (p) => {
    if (p === parity.value || !subEditor.value) return;
    drafts[parity.value] = subEditor.value.getHTML();
    parity.value = p;
    if (drafts[p] === undefined) drafts[p] = htmlFor(p);
    subEditor.value.commands.setContent(drafts[p]);
    subEditor.value.commands.focus('end');
};

const commit = () => {
    if (mode.value !== 'edit') return;
    document.removeEventListener('mousedown', onDocMousedown, true);
    hfActive?.unregister(hfApi);
    reportFocus?.(null); // 子编辑器即将销毁，工具栏目标置空（避免对已销毁实例发命令）
    if (subEditor.value) {
        // 空段落补 <br>：PM 序列化空 <p> 不带 <br>，预览/打印下空段高度塌成 0（编辑态 PM 视图会补 br 占一行），
        // 补上后初始/编辑/预览/打印四态行高一致（坑 #41 之后的又一处序列化不对称）
        // PM schema 给表格结尾补的空段落不进保存（预览 HTML 没有它，存了下次进入又高一行）
        drafts[parity.value] = subEditor.value
            .getHTML()
            .replace(/<p([^>]*)><\/p>/g, '<p$1><br></p>')
            .replace(/(<p[^>]*>(<br\s*\/?>)?<\/p>)+\s*$/, '');
        subEditor.value.destroy();
        subEditor.value = null;
        if (window.__hfs) delete window.__hfs[`${props.section.id}:${props.kind}`];
    }
    const patch = {};
    if (drafts.odd !== undefined && drafts.odd !== props.section[props.kind]) patch[props.kind] = drafts.odd;
    if (drafts.even !== undefined && drafts.even !== (props.section[evenKey.value] || '')) patch[evenKey.value] = drafts.even;
    mode.value = 'preview';
    if (Object.keys(patch).length) emit('save', patch);
    emit('closed'); // 浮层模式（间隙条原位编辑）由父组件据此卸载本组件
};

// ---- 高度上报：RO 挂根元素，报整个 .hf 盒高（含 .hf.header/footer 的 padding——
// 打印侧 measureHfHeights 量的也是 .hf 包装整盒，两边同源才能用同一引擎换算）----
let ro = null;
const reportHeight = () => {
    if (!rootEl.value) return;
    emit('resize', rootEl.value.offsetHeight); // offsetHeight=未缩放布局值（zoom 坐标系，坑 #35）
};
watch(mode, async () => { await nextTick(); reportHeight(); });
watch(rootEl, (el) => {
    ro?.disconnect();
    if (el) { ro = new ResizeObserver(reportHeight); ro.observe(el); }
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMousedown, true);
    hfActive?.unregister(hfApi);
    ro?.disconnect();
    subEditor.value?.destroy();
});

onMounted(() => {
    // 浮层模式：挂载即进编辑（间隙条双击原位展开；parity 由调用方按本条页码奇偶指定）
    if (props.startEditing) enterEdit({ parity: props.startParity ?? undefined });
});

defineExpose({ enterEdit, commit }); // commit 暴露给浮层宿主：zoom 变化等场景先保存再卸载
</script>

<template>
    <div
        ref="rootEl" class="hf-editor hf" :class="[kind, { 'hf-editing': mode === 'edit', 'hf-editable': editable && mode === 'preview' }]"
        @dblclick="enterEdit"
    >
        <div v-if="mode === 'preview'" ref="previewEl" class="hf-content" v-html="previewHtml"></div>
        <template v-else>
            <!-- 无任何编辑条/提示文字（带内空间紧张）；奇偶切换在右键菜单"页眉/页脚设置"里 -->
            <div ref="editEl" class="hf-subeditor"></div>
            <TableFloatingMenu v-if="subEditor" :editor="subEditor" />
            <ImageFloatingMenu v-if="subEditor" :editor="subEditor" />
        </template>
    </div>
</template>
