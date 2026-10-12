<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import TieredMenu from 'primevue/tieredmenu';
import ColorPaletteButton from './ColorPaletteButton.vue';
import { BULLET_TYPES, ORDERED_TYPES } from '../tiptap/index.js';
import { notify } from '../notify.js';

/**
 * 工具栏（仅编辑态渲染——只读态整条隐藏省窗口，用户 2026-08-28；PrimeVue 图标按钮 + tooltip）：
 * - 格式组作用于最近聚焦的编辑器实例；
 *   **渐进式折叠**——宽度不足时按组依次收进下拉按钮（插入 → 标题/题注 → 对齐 → 列表 → 格式 → 字体），
 *   <350px 全部收进 ⋯，任何宽度都不溢出
 * 编辑/只读切换与导出 PDF 不在此处——已挪到右键 ContextMenu（查看动作任何状态可用）。
 * 表格行列操作不在这里——光标进表格时由 TableFloatingMenu 在单元格上方浮出。
 * 依赖宿主注册 PrimeVue（standard 主应用已有）。
 */
const props = defineProps({
    editor: { type: Object, default: null }, // 当前聚焦的 tiptap Editor，可为 null
    lang: { type: String, default: 'zh' } // 文档语言：英文默认字体 Times/11pt（用户 2026-09-04），zh=宋体/12
});
const emit = defineEmits(['insert-section']);

// —— 选区状态跟随：transaction 时 bump tick，让 isActive/getAttributes 重新求值 ——
const tick = ref(0);
const bump = () => tick.value++;
watch(
    () => props.editor,
    (ed, prev) => {
        prev?.off('transaction', bump);
        ed?.on('transaction', bump);
    },
    { immediate: true }
);
onBeforeUnmount(() => props.editor?.off('transaction', bump));

const cmd = (fn) => {
    if (!props.editor) return;
    fn(props.editor.chain().focus()).run();
};
const isActive = (name, attrs) => (tick.value, props.editor?.isActive(name, attrs) ?? false);
const getAttr = (mark, attr) => (tick.value, props.editor?.getAttributes(mark)?.[attr] ?? '');

// —— 字体 / 字号（常显当前值：无显式设置时显示默认 zh=宋体/12、en=Times/11，无清除按钮） ——
const isEn = computed(() => props.lang === 'en');
const DEFAULT_FONT = computed(() => (isEn.value ? "'Times New Roman', serif" : 'SimSun, serif'));
const DEFAULT_SIZE = computed(() => (isEn.value ? '11' : '12')); // EN 正文 11pt（.lang-en 正文样式互指）
const fontFamilies = computed(() => {
    const zh = [
        { label: '宋体', value: 'SimSun, serif' },
        { label: '黑体', value: 'SimHei, sans-serif' },
        { label: '楷体', value: 'KaiTi, cursive' },
        { label: '仿宋', value: 'FangSong, serif' },
        { label: '微软雅黑', value: "'Microsoft YaHei', sans-serif" }
    ];
    const latin = [
        { label: 'Times', value: "'Times New Roman', serif" },
        { label: 'Arial', value: 'Arial, sans-serif' }
    ];
    return isEn.value ? [...latin, ...zh] : [...zh, ...latin];
});
const fontSizes = ['9', '10.5', '11', '12', '14', '16', '18', '22'].map((s) => ({ label: s, value: s }));
const fontFamilyModel = ref(DEFAULT_FONT.value);
const fontSizeModel = ref(DEFAULT_SIZE.value);
watch(tick, () => {
    // 选区有显式字体/字号 → 显示之；否则回落到默认（zh=宋体/12、en=Times/11，与正文内容样式一致）
    const ff = getAttr('textStyle', 'fontFamily');
    fontFamilyModel.value = fontFamilies.value.some((f) => f.value === ff) ? ff : DEFAULT_FONT.value;
    const fs = (getAttr('textStyle', 'fontSize') || '').replace('pt', '');
    fontSizeModel.value = fontSizes.some((s) => s.value === fs) ? fs : DEFAULT_SIZE.value;
});
// lang 切换（demo 中英模板切换）：无显式值时回落目标语言默认
watch(isEn, () => {
    if (!fontFamilies.value.some((f) => f.value === getAttr('textStyle', 'fontFamily'))) fontFamilyModel.value = DEFAULT_FONT.value;
    if (!fontSizes.some((s) => s.value === (getAttr('textStyle', 'fontSize') || '').replace('pt', ''))) fontSizeModel.value = DEFAULT_SIZE.value;
});
const onFontFamily = (v) => cmd((c) => (v ? c.setFontFamily(v) : c.unsetFontFamily()));
const onFontSize = (v) => cmd((c) => (v ? c.setFontSize(v + 'pt') : c.unsetFontSize()));

// —— 颜色 / 高亮（Word 同款下拉色板组件 ColorPaletteButton；apply 收 #hex 或 null=清除） ——
const curTextColor = () => (tick.value, props.editor?.getAttributes('textStyle')?.color ?? '');
const curHighlight = () => (tick.value, props.editor?.getAttributes('highlight')?.color ?? '');
const onColorApply = (hex) => cmd((c) => (hex ? c.setColor(hex) : c.unsetColor()));
const onHighlightApply = (hex) => cmd((c) => (hex ? c.setHighlight({ color: hex }) : c.unsetHighlight()));
// 折叠菜单里的预设项（色板面板塞不进 TieredMenu，沿用预设列表）
const applyColor = (v) => onColorApply('#' + v);
const applyHighlight = (v) => onHighlightApply('#' + v);

// —— 图标按钮组定义 ——
// 注意：primeicons v7 已删除 pi-bold/pi-italic/pi-underline/pi-strikethrough 字形（对齐类还在），
// B/I/U/S 用 Word 同款字母字形（.mk-glyph），不依赖图标字体，宿主升级图标库也不会丢
const markBtns = [
    { glyph: 'B', glyphStyle: 'font-weight:700', tip: '加粗', active: () => isActive('bold'), run: (c) => c.toggleBold() },
    { glyph: 'I', glyphStyle: 'font-style:italic;font-family:Georgia,serif', tip: '斜体', active: () => isActive('italic'), run: (c) => c.toggleItalic() },
    { glyph: 'U', glyphStyle: 'text-decoration:underline', tip: '下划线', active: () => isActive('underline'), run: (c) => c.toggleUnderline() },
    { glyph: 'S', glyphStyle: 'text-decoration:line-through', tip: '删除线', active: () => isActive('strike'), run: (c) => c.toggleStrike() }
];
const alignBtns = [
    { icon: 'pi pi-align-left', tip: '左对齐', val: 'left' },
    { icon: 'pi pi-align-center', tip: '居中', val: 'center' },
    { icon: 'pi pi-align-right', tip: '右对齐', val: 'right' },
    { icon: 'pi pi-align-justify', tip: '两端对齐', val: 'justify' }
];
const blockBtns = [
    { label: 'H1', tip: '一级标题', active: () => isActive('heading', { level: 1 }), run: (c) => c.toggleHeading({ level: 1 }) },
    { label: 'H2', tip: '二级标题', active: () => isActive('heading', { level: 2 }), run: (c) => c.toggleHeading({ level: 2 }) },
    { label: 'H3', tip: '三级标题', active: () => isActive('heading', { level: 3 }), run: (c) => c.toggleHeading({ level: 3 }) }
];

// —— 列表标记样式：点击列表按钮直接弹出标记菜单（无单独 caret 箭头），列表已开时首项为"取消列表" ——
// 自定义格式（dash/paren/pparen/angle）走 class + CSS counter，见 tiptap/lists.js 与 editor.css
const bulletMenuRef = ref(null);
const orderedMenuRef = ref(null);
const curListType = (name, dflt) => (tick.value, props.editor?.getAttributes(name)?.listType ?? dflt);
const setListType = (listName, value) => {
    const ed = props.editor;
    if (!ed) return;
    let c = ed.chain().focus();
    if (!ed.isActive(listName)) c = listName === 'bulletList' ? c.toggleBulletList() : c.toggleOrderedList();
    c.updateAttributes(listName, { listType: value }).run();
};
const listItems = (name, types, dflt, toggle) => [
    ...(isActive(name)
        ? [{ label: '取消列表', icon: 'pi pi-times', command: () => cmd(toggle) }, { separator: true }]
        : []),
    ...types.map((t) => ({
        label: t.label,
        icon: isActive(name) && curListType(name, dflt) === t.value ? 'pi pi-check' : undefined,
        command: () => setListType(name, t.value)
    }))
];
const bulletItems = computed(() => listItems('bulletList', BULLET_TYPES, 'disc', (c) => c.toggleBulletList()));
const orderedItems = computed(() => listItems('orderedList', ORDERED_TYPES, 'decimal', (c) => c.toggleOrderedList()));

// —— 题注（"图 N"编号段落，编号 CSS counter 自动生成） ——
// 两种用法（2026-09-11 二轮：此前只支持第一种，用户投诉"题注是死的，打的文字转不了题注"）：
// ① 选中图片（NodeSelection）→ 在图片节点后插入空题注段落并进入编辑；
// ② 光标在顶层正文段落 → 该段 ⇄ 题注互转（caption 就是段落属性，updateAttributes 天然可逆）。
// 表格单元格内段落（depth>1）不可用——表格内不该出"图 N"编号；
// 含 locked 字段的段落由 LockedRegionGuard 拒改，天然兜底。
const imgSelected = () => (tick.value, props.editor?.state.selection.node?.type.name === 'image');
const captionPara = () => {
    const $f = (tick.value, props.editor?.state.selection.$from);
    return $f?.depth === 1 && $f.parent.type.name === 'paragraph' ? $f : null;
};
const captionOn = () => !!captionPara()?.parent.attrs.caption;
const captionUsable = () => imgSelected() || !!captionPara();
const insertCaption = () => {
    const ed = props.editor;
    const sel = ed?.state.selection;
    if (!sel?.node || sel.node.type.name !== 'image') return;
    const pos = sel.from + sel.node.nodeSize;
    ed.chain().insertContentAt(pos, { type: 'paragraph', attrs: { caption: true }, content: [] }).setTextSelection(pos + 1).focus().run();
};
const onCaptionClick = () => {
    const ed = props.editor;
    if (!ed) return;
    if (imgSelected()) return insertCaption(); // ① 选中图片：图片下方插新题注
    const $f = captionPara();
    if (!$f) return;
    ed.chain().focus().updateAttributes('paragraph', { caption: !$f.parent.attrs.caption }).run(); // ② 段落 ⇄ 题注
};

// —— 插入图片：本地文件 → base64 dataURL 进 JSON（定版渲染自带，无需上传链路） ——
const imgInput = ref(null);
const pickImage = () => imgInput.value?.click();
const onImagePicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file || !props.editor) return;
    const reader = new FileReader();
    reader.onload = () => props.editor.chain().focus().setImage({ src: reader.result }).run();
    reader.readAsDataURL(file);
};

// —— 插入节（纸张 × 方向） ——
const sectionMenuOpen = ref(false);
const sectionPresets = [
    { pageSize: 'A4', orientation: 'portrait', label: 'A4 纵向' },
    { pageSize: 'A4', orientation: 'landscape', label: 'A4 横向' },
    { pageSize: 'A3', orientation: 'portrait', label: 'A3 纵向' },
    { pageSize: 'A3', orientation: 'landscape', label: 'A3 横向' }
];
const insertSection = (preset) => {
    emit('insert-section', preset);
    sectionMenuOpen.value = false;
};

// —— 插入 CAD 图纸（2026-09-23）：本地 DXF 上传即转换出图（隐藏挂载，不开弹窗）/ 空白图纸双击再编辑 ——
const cadMenuOpen = ref(false);
const cadConverting = ref(false);
const cadInput = ref(null);
const pickCadLocal = () => {
    cadMenuOpen.value = false;
    cadInput.value?.click();
};
const onCadPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !props.editor) return;
    if (file.size > 10 * 1024 * 1024) return notify.error(`图纸过大（${(file.size / 1024 / 1024).toFixed(1)}MB > 10MB），请精简后再插入`);
    cadConverting.value = true;
    try {
        const { convertCadFileToNodeAttrs } = await import('../cad/cadConvert.js'); // 动态 import：mlightcad 不进主 chunk
        const attrs = await convertCadFileToNodeAttrs(file);
        // createParagraphNear：块级 atom 后补尾随段落——光标落正常文本段落（不出横向 GapCursor），节点下方留自然空隙
        props.editor.chain().focus().insertContent({ type: 'cadDrawing', attrs }).createParagraphNear().run();
    } catch (err) {
        notify.error(err?.message || 'CAD 图纸转换失败');
    } finally {
        cadConverting.value = false;
    }
};
const insertBlankCad = () => {
    cadMenuOpen.value = false;
    cmd((c) => c.insertContent({ type: 'cadDrawing' }).createParagraphNear()); // preview/data 皆 null → 虚线占位区，双击开弹窗编辑
};
const cadItems = [
    { label: '本地文件（DXF）', icon: 'pi pi-folder-open', command: pickCadLocal },
    { label: '空白图纸', icon: 'pi pi-file', command: insertBlankCad }
];

// —— 渐进式折叠：宽度不足时按组依次收进下拉按钮，任何宽度都不溢出 ——
// stage 0=全显；1 收「插入」组（表格/图片/分页符/节）；2 再收「标题/题注」；3 再收「对齐」；
// 4 再收「列表」；5 再收「格式」（B/I/U/S+颜色/高亮）；6 再收「字体/字号」；7(<350) 全部收进 ⋯
// 阈值 = 各档实测最小内容宽 + 余量（debug-fold-measure.js；<780px 有 compact CSS 压缩按钮内边距）
// 关键：必须量"工具栏自身容器宽"（ResizeObserver），不能看 window.innerWidth——
// 宿主 standard 里编辑器只是右侧 SplitterPanel（~70% 视口），window 宽 ≠ 栏宽，看 window 会少折叠导致溢出遮蔽
const stage = ref(0);
const barRef = ref(null);
const barWidth = ref(0);
const onResize = () => {
    const w = barRef.value?.clientWidth || window.innerWidth;
    barWidth.value = w;
    stage.value = w >= 1250 ? 0 : w >= 1110 ? 1 : w >= 960 ? 2 : w >= 830 ? 3 : w >= 780 ? 4 : w >= 560 ? 5 : w >= 350 ? 6 : 7;
};
let barRO = null;
onMounted(() => {
    onResize();
    barRO = new ResizeObserver(onResize);
    if (barRef.value) barRO.observe(barRef.value);
});
onBeforeUnmount(() => barRO?.disconnect());

// 各折叠组的下拉菜单（TieredMenu popup）
const insertMenuRef = ref(null);
const insertItems = [
    { label: '插入表格', icon: 'pi pi-table', command: () => cmd((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
    { label: '插入图片', icon: 'pi pi-image', command: pickImage },
    { label: '插入 CAD 图纸', icon: 'pi pi-cad', items: cadItems },
    { label: '插入分页符', icon: 'pi pi-minus', command: () => cmd((c) => c.insertPageBreak()) },
    { separator: true },
    { label: '插入节', icon: 'pi pi-file-plus', items: sectionPresets.map((p) => ({ label: p.label, command: () => insertSection(p) })) }
];
const headingMenuRef = ref(null);
const headingItems = computed(() => [
    ...blockBtns.map((b) => ({ label: `${b.tip}（${b.label}）`, command: () => cmd(b.run) })),
    {
        label: captionOn() ? '取消题注' : '题注',
        icon: captionOn() ? 'pi pi-check' : 'pi pi-tag',
        disabled: !captionUsable(),
        command: onCaptionClick
    }
]);
const alignMenuRef = ref(null);
const alignItems = computed(() =>
    alignBtns.map((b) => ({ label: b.tip, icon: isActive({ textAlign: b.val }) ? 'pi pi-check' : b.icon, command: () => cmd((c) => c.setTextAlign(b.val)) }))
);
const listMenuRef = ref(null);
const listMenuItems = computed(() => [
    { label: '无序列表', icon: 'pi pi-list', items: bulletItems.value },
    { label: '有序列表', icon: 'pi pi-sort-numeric-down', items: orderedItems.value }
]);
// 格式组折叠：B/I/U/S（当前态带 ✓）+ 颜色/高亮预设（ColorPicker 塞不进菜单，给常用预设）
const formatMenuRef = ref(null);
const formatItems = computed(() => [
    ...markBtns.map((b) => ({ label: b.tip, icon: b.active() ? 'pi pi-check' : undefined, command: () => cmd(b.run) })),
    { separator: true },
    {
        label: '文字颜色',
        icon: 'pi pi-palette',
        items: [
            { label: '黑色', command: () => applyColor('000000') },
            { label: '深灰', command: () => applyColor('595959') },
            { label: '红色', command: () => applyColor('dc2626') },
            { label: '蓝色', command: () => applyColor('2563eb') },
            { label: '绿色', command: () => applyColor('16a34a') }
        ]
    },
    {
        label: '高亮色',
        icon: 'pi pi-palette',
        items: [
            { label: '黄色', command: () => applyHighlight('ffff00') },
            { label: '浅绿', command: () => applyHighlight('bbf7d0') },
            { label: '浅蓝', command: () => applyHighlight('bfdbfe') },
            { label: '浅红', command: () => applyHighlight('fecaca') }
        ]
    },
    { separator: true },
    { label: '取消高亮', icon: 'pi pi-eraser', command: () => cmd((c) => c.unsetHighlight()) }
]);
const fontMenuRef = ref(null);
const fontItems = computed(() => [
    {
        label: '字体',
        items: fontFamilies.value.map((f) => ({ label: f.label, icon: fontFamilyModel.value === f.value ? 'pi pi-check' : undefined, command: () => onFontFamily(f.value) }))
    },
    {
        label: '字号',
        items: fontSizes.map((s) => ({ label: s.label, icon: fontSizeModel.value === s.value ? 'pi pi-check' : undefined, command: () => onFontSize(s.value) }))
    }
]);
// stage 7（<350px）：全部功能收进统一的 ⋯ 菜单
const allMenuRef = ref(null);
const allItems = computed(() => [
    ...fontItems.value,
    { separator: true },
    { label: '格式', icon: 'pi pi-palette', items: formatItems.value },
    { label: '对齐', icon: 'pi pi-align-left', items: alignItems.value },
    { label: '标题 / 题注', items: headingItems.value },
    ...listMenuItems.value,
    { separator: true },
    ...insertItems
]);
</script>

<template>
    <!-- 工具栏（仅编辑态渲染）：格式组，无聚焦编辑器时置灰；编辑/只读切换与导出 PDF 在右键菜单 -->
    <div ref="barRef" class="format-bar" :class="{ compact: barWidth < 780 }">
        <div class="fmt-groups" :class="{ disabled: !editor }">
        <span class="sep"></span>
        <!-- 字体/字号：stage≤5 内联，stage6 收成「字体」下拉，stage7 进 ⋯ -->
        <template v-if="stage <= 5">
            <Select
                v-model="fontFamilyModel" :options="fontFamilies" option-label="label" option-value="value"
                class="font-select" size="small" @update:model-value="onFontFamily"
            />
            <Select
                v-model="fontSizeModel" :options="fontSizes" option-label="label" option-value="value"
                class="font-select size" size="small" @update:model-value="onFontSize"
            />
        </template>
        <Button v-else-if="stage === 6" v-tooltip.bottom="'字体 / 字号'" label="字体" text rounded size="small" class="fold-btn" @click="fontMenuRef?.toggle($event)" />
        <span class="sep"></span>
        <!-- 格式组（B/I/U/S+颜色/高亮）：stage≤4 内联，stage5-6 收成下拉 -->
        <template v-if="stage <= 4">
            <Button
                v-for="b in markBtns" :key="b.tip" v-tooltip.bottom="b.tip"
                text rounded size="small" :class="{ on: b.active() }" @click="cmd(b.run)"
            >
                <span class="mk-glyph" :style="b.glyphStyle">{{ b.glyph }}</span>
            </Button>
            <ColorPaletteButton type="color" :current="curTextColor()" tip="文字颜色" @apply="onColorApply" />
            <ColorPaletteButton type="highlight" :current="curHighlight()" tip="高亮色" @apply="onHighlightApply" />
            <Button v-tooltip.bottom="'取消高亮'" icon="pi pi-eraser" text rounded size="small" @click="cmd((c) => c.unsetHighlight())" />
        </template>
        <Button v-else-if="stage <= 6" v-tooltip.bottom="'格式'" icon="pi pi-palette" text rounded size="small" class="fold-btn" @click="formatMenuRef?.toggle($event)" />
        <input ref="imgInput" type="file" accept="image/*" style="display: none" @change="onImagePicked" />
        <input ref="cadInput" type="file" accept=".dxf" style="display: none" @change="onCadPicked" />
        <!-- 对齐：stage≤2 内联，stage3-6 收成下拉 -->
        <template v-if="stage <= 2">
            <span class="sep"></span>
            <Button
                v-for="b in alignBtns" :key="b.val" v-tooltip.bottom="b.tip" :icon="b.icon"
                text rounded size="small" :class="{ on: isActive({ textAlign: b.val }) }"
                @click="cmd((c) => c.setTextAlign(b.val))"
            />
        </template>
        <Button v-else-if="stage <= 6" v-tooltip.bottom="'对齐'" icon="pi pi-align-left" text rounded size="small" class="fold-btn" @click="alignMenuRef?.toggle($event)" />
        <!-- 标题/题注：stage≤1 内联，stage2-6 收成下拉 -->
        <template v-if="stage <= 1">
            <span class="sep"></span>
            <Button
                v-for="b in blockBtns" :key="b.tip" v-tooltip.bottom="b.tip" :label="b.label"
                text rounded size="small" :class="{ on: b.active?.() }" @click="cmd(b.run)"
            />
            <Button
                v-tooltip.bottom="'题注：选中图片=下方插入；光标在正文行=该行转/取消题注'" label="题注" text rounded size="small"
                class="cap-btn" :class="{ on: captionOn() }" :disabled="!captionUsable()" @click="onCaptionClick"
            />
        </template>
        <Button v-else-if="stage <= 6" v-tooltip.bottom="'标题 / 题注'" label="标题" text rounded size="small" class="fold-btn" @click="headingMenuRef?.toggle($event)" />
        <!-- 列表：stage≤3 内联，stage4-6 收成下拉 -->
        <template v-if="stage <= 3">
            <span class="sep"></span>
            <Button v-tooltip.bottom="'无序列表'" icon="pi pi-list" text rounded size="small" :class="{ on: isActive('bulletList') }" @click="bulletMenuRef?.toggle($event)" />
            <Button v-tooltip.bottom="'有序列表'" icon="pi pi-sort-numeric-down" text rounded size="small" :class="{ on: isActive('orderedList') }" @click="orderedMenuRef?.toggle($event)" />
        </template>
        <Button v-else-if="stage <= 6" v-tooltip.bottom="'列表'" icon="pi pi-list" text rounded size="small" class="fold-btn" @click="listMenuRef?.toggle($event)" />
        <!-- 插入组：stage0 内联，stage1-6 收成「插入」下拉（最先折叠） -->
        <template v-if="stage === 0">
            <span class="sep"></span>
            <Button v-tooltip.bottom="'插入表格'" icon="pi pi-table" text rounded size="small" @click="cmd((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))" />
            <Button v-tooltip.bottom="'插入图片'" icon="pi pi-image" text rounded size="small" @click="pickImage" />
            <Button v-tooltip.bottom="'插入分页符'" icon="pi pi-minus" text rounded size="small" @click="cmd((c) => c.insertPageBreak())" />
            <div class="insert-section">
                <Button v-tooltip.bottom="'插入节'" icon="pi pi-file-plus" text rounded size="small" @click="sectionMenuOpen = !sectionMenuOpen" />
                <div v-if="sectionMenuOpen" class="insert-section-menu">
                    <button v-for="p in sectionPresets" :key="p.label" @click="insertSection(p)">{{ p.label }}</button>
                </div>
            </div>
            <div class="insert-section">
                <Button
                    v-tooltip.bottom="'插入 CAD 图纸（DXF）'" icon="pi pi-cad" text rounded size="small"
                    :loading="cadConverting" :disabled="cadConverting" @click="cadMenuOpen = !cadMenuOpen"
                />
                <div v-if="cadMenuOpen" class="insert-section-menu">
                    <button v-for="it in cadItems" :key="it.label" @click="it.command()">{{ it.label }}</button>
                </div>
            </div>
        </template>
        <Button v-else-if="stage <= 6" v-tooltip.bottom="'插入'" icon="pi pi-plus" text rounded size="small" class="fold-btn" @click="insertMenuRef?.toggle($event)" />
        <!-- stage7（<350px）：全部收进统一的 ⋯ 菜单 -->
        <Button v-if="stage >= 7" v-tooltip.bottom="'更多'" icon="pi pi-ellipsis-h" text rounded size="small" class="fold-btn" @click="allMenuRef?.toggle($event)" />
        <!-- 折叠组的弹出菜单（popup TieredMenu；列表两个菜单任何 stage 都要渲染，内联按钮和折叠子菜单共用） -->
        <TieredMenu ref="bulletMenuRef" :model="bulletItems" popup />
        <TieredMenu ref="orderedMenuRef" :model="orderedItems" popup />
        <TieredMenu v-if="stage === 6" ref="fontMenuRef" :model="fontItems" popup />
        <TieredMenu v-if="stage >= 5 && stage <= 6" ref="formatMenuRef" :model="formatItems" popup />
        <TieredMenu v-if="stage >= 3 && stage <= 6" ref="alignMenuRef" :model="alignItems" popup />
        <TieredMenu v-if="stage >= 2 && stage <= 6" ref="headingMenuRef" :model="headingItems" popup />
        <TieredMenu v-if="stage >= 4 && stage <= 6" ref="listMenuRef" :model="listMenuItems" popup />
        <TieredMenu v-if="stage >= 1 && stage <= 6" ref="insertMenuRef" :model="insertItems" popup />
        <TieredMenu v-if="stage >= 7" ref="allMenuRef" :model="allItems" popup />
        </div>
    </div>
</template>
