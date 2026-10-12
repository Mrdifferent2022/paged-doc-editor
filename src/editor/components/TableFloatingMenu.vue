<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import TieredMenu from 'primevue/tieredmenu';
import { CellSelection } from '@tiptap/pm/tables';
import { findTable, colwidthTotal, scaleTableColwidths, tableLimitPx } from '../tiptap/tableUtils.js';

/**
 * 表格操作手柄×2 + 弹出菜单（tiptap pro / PrimeVue 风格）：
 * - 平时不浮菜单——光标在表格里时才出现两个手柄：
 *   ① 左上角 .table-handle（Notion 同款）：表格整体操作——左/中/右对齐、适应版心宽度、删除表格；
 *   ② 当前单元格/选区右边线中间的 ⋮ 手柄：单元格/行/列操作，菜单项按选区动态差异化：
 *      单格=行+列+(拆分)+表头+背景色；整行选=行操作+合并+(拆分)+背景色；整列选=列操作+合并+(拆分)+背景色；
 *      矩形块选=合并+(拆分)+背景色；拆分仅在选区含合并格时出现；删表已挪到表格菜单（防误删）；
 * - 单格聚焦蓝框高亮（ActiveCell node Decoration）；多选（CellSelection）选区整体外框描边 + 手柄移到选区右侧中间；
 * - 插列自动等比收缩列宽防溢出（tableUtils.scaleTableColwidths）；拖列超版心由 TableWidthClamp 插件钳制。
 */
const props = defineProps({
    editor: { type: Object, required: true }
});

const visible = ref(false); // 单元格手柄可见
const pos = ref({ left: 0, top: 0 });
const selRect = ref(null); // 多选单元格的外包矩形（悬浮层内坐标=视口 rect 减层偏移，无层时=视口坐标），用于整体外框描边
const menuRef = ref(null);
let pendingRect = null; // 手柄锚定的矩形（多选=选区外包矩形，单选=当前单元格）
// 手柄 Teleport 到悬浮层/body 跳出了 zoom 容器，元素本身不随页面缩放 → 实测编辑器 DOM 的 zoom 比，
// 用手柄 transform: scale 同步缩放（任何时候手柄都跟随页面缩放比例，不超单元格宽）
const zoom = ref(1);

// 悬浮层（2026-09-22 穿透修复）：SectionedEditor 提供的裁剪层（ref 持有 DOM 元素）。
// 有层：Teleport 进层、坐标存层内系（锚点视口 rect 减层 rect）、钳制目标=层可视矩形，出界被层 overflow 裁断；
// 无层（独立用法/demo 异常态）：回退 body + fixed + 钳 window 旧行为，功能不炸
const floatingLayer = inject('floatingLayer', null);
const layerRect = () => floatingLayer?.value?.getBoundingClientRect() ?? null;

// —— 表格整体手柄（左上角）状态 ——
const tableVisible = ref(false);
const tablePos = ref({ left: 0, top: 0 });
const tableMenuRef = ref(null);
const curAlign = ref(null); // 当前表格 align（null=默认左贴）
const canFit = ref(false); // 全列有 colwidth 才能"适应版心宽度"

// —— 单元格菜单动态化：选区模式 + 选区是否含合并格 ——
const selMode = ref('cell'); // 'cell' | 'row' | 'col' | 'block'
const hasMerged = ref(false);

const hideMenus = () => {
    menuRef.value?.hide();
    tableMenuRef.value?.hide();
};

// 软分页衬垫行（data-vp-pad=加高量，未缩放布局 px）：格盒被加高撑长跨进页间隙，
// 手柄/选区描边锚点须钳回自然行底（rect 是视口缩放坐标 → 乘 zoom）
const padOf = (cellDom) => Number(cellDom?.closest('tr')?.dataset.vpPad || 0) * zoom.value;
const clampRect = (r, cellDom) => {
    const pad = padOf(cellDom);
    if (!pad) return r;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom - pad, width: r.width, height: r.height - pad };
};

// 多选单元格的外包矩形；非 CellSelection 返回 null
const getSelectionRect = () => {
    const { state, view } = props.editor;
    const sel = state.selection;
    if (!(sel instanceof CellSelection)) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, n = 0;
    sel.forEachCell((node, p) => {
        const dom = view.nodeDOM(p);
        if (dom && dom.nodeType === 1) {
            const r = dom.getBoundingClientRect();
            left = Math.min(left, r.left);
            top = Math.min(top, r.top);
            right = Math.max(right, r.right);
            bottom = Math.max(bottom, r.bottom - padOf(dom));
            n++;
        }
    });
    if (!n) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
};

const run = (fn) => {
    hideMenus(); // 命令执行后确保菜单收起（链式 focus 可能干扰弹出层的自动隐藏时序）
    fn(props.editor.chain().focus()).run();
    update(); // 操作后选区可能移动，重定位
};

const setBg = (color) => run((c) => c.setCellAttribute('backgroundColor', color));
const clearBg = () => run((c) => c.setCellAttribute('backgroundColor', null));

// 复制当前行：克隆行节点插到其后
const duplicateRow = () => {
    hideMenus();
    const { state, view } = props.editor;
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'tableRow') {
            view.dispatch(state.tr.insert($from.after(d), $from.node(d)));
            return;
        }
    }
};

// —— 插列防溢出：加列后总列宽会超纸宽，按比例收缩所有列宽回原总宽 ——
const addColumnFit = (dir) => {
    hideMenus();
    const ed = props.editor;
    const before = findTable(ed.state.selection.$from);
    const totalBefore = before ? colwidthTotal(before.node) : null;
    (dir === 'before' ? ed.chain().focus().addColumnBefore() : ed.chain().focus().addColumnAfter()).run();
    if (!totalBefore) return update();
    const after = findTable(ed.state.selection.$from);
    if (!after) return update();
    const totalAfter = colwidthTotal(after.node);
    if (!totalAfter || totalAfter <= totalBefore) return update();
    const { state, view } = ed;
    const tr = state.tr;
    if (scaleTableColwidths(tr, after.pos, after.node, totalBefore / totalAfter)) view.dispatch(tr);
    update();
};

// —— 表格整体操作 ——
const setAlign = (a) => run((c) => c.updateAttributes('table', { align: a }));

// 适应版心宽度：Σcolwidth 等比缩放到表格可用宽（定宽表才有意义，无 colwidth 时菜单禁用）
const fitContentWidth = () => {
    hideMenus();
    const { state, view } = props.editor;
    const t = findTable(state.selection.$from);
    const total = t && colwidthTotal(t.node);
    const limit = t && tableLimitPx(view, t.pos);
    if (!total || !limit || Math.abs(total - limit) <= 1) return;
    const tr = state.tr;
    if (scaleTableColwidths(tr, t.pos, t.node, limit / total)) view.dispatch(tr);
    update();
};

const alignIcon = (a, base) => (curAlign.value === a || (a === 'left' && !curAlign.value) ? 'pi pi-check' : base);
const tableItems = computed(() => [
    { label: '左对齐', icon: alignIcon('left', 'pi pi-align-left'), command: () => setAlign(null) },
    { label: '居中', icon: alignIcon('center', 'pi pi-align-center'), command: () => setAlign('center') },
    { label: '右对齐', icon: alignIcon('right', 'pi pi-align-right'), command: () => setAlign('right') },
    { separator: true },
    { label: '适应版心宽度', icon: 'pi pi-arrows-h', disabled: !canFit.value, command: fitContentWidth },
    { separator: true },
    { label: '删除表格', icon: 'pi pi-trash', class: 'tm-danger', command: () => run((c) => c.deleteTable()) }
]);

// —— 单元格菜单（按选区动态组装；背景色为色点子菜单） ——
const bgPresets = [
    { label: '无背景', dot: '#ffffff', command: clearBg },
    { label: '浅黄', dot: '#fff7cc', command: () => setBg('#fff7cc') },
    { label: '浅绿', dot: '#e7f6e7', command: () => setBg('#e7f6e7') },
    { label: '浅蓝', dot: '#e8f0fe', command: () => setBg('#e8f0fe') },
    { label: '浅红', dot: '#fde8e8', command: () => setBg('#fde8e8') },
    { label: '浅灰', dot: '#f3f4f6', command: () => setBg('#f3f4f6') }
];
const rowOps = [
    { label: '上方插行', icon: 'pi pi-arrow-up', command: () => run((c) => c.addRowBefore()) },
    { label: '下方插行', icon: 'pi pi-arrow-down', command: () => run((c) => c.addRowAfter()) },
    { label: '复制行', icon: 'pi pi-clone', command: duplicateRow },
    { label: '删除行', icon: 'pi pi-minus', command: () => run((c) => c.deleteRow()) }
];
const colOps = [
    { label: '左侧插列', icon: 'pi pi-arrow-left', command: () => addColumnFit('before') },
    { label: '右侧插列', icon: 'pi pi-arrow-right', command: () => addColumnFit('after') },
    { label: '删除列', icon: 'pi pi-times', command: () => run((c) => c.deleteColumn()) }
];
const mergeItem = { label: '合并', icon: 'pi pi-objects-column', command: () => run((c) => c.mergeCells()) };
const splitItem = { label: '拆分', icon: 'pi pi-th-large', command: () => run((c) => c.splitCell()) };
const headerItem = { label: '表头行', icon: 'pi pi-bookmark', command: () => run((c) => c.toggleHeaderRow()) };
const bgItem = { label: '背景色', icon: 'pi pi-palette', items: bgPresets };

const items = computed(() => {
    const split = hasMerged.value ? [splitItem] : [];
    switch (selMode.value) {
        case 'row':
            return [...rowOps, { separator: true }, mergeItem, ...split, bgItem];
        case 'col':
            return [...colOps, { separator: true }, mergeItem, ...split, bgItem];
        case 'block':
            return [mergeItem, ...split, bgItem];
        default: // 单格光标：全量行列操作；合并无意义不显示，拆分仅当前格是合并格时显示
            return [...rowOps, { separator: true }, ...colOps, { separator: true }, ...split, headerItem, bgItem];
    }
});

const toggleMenu = (e) => menuRef.value?.toggle(e);

// —— 当前单元格 DOM（定位用；高亮由 ActiveCell 扩展的 node Decoration 负责） ——
const findCellDom = () => {
    const { state, view } = props.editor;
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const name = $from.node(d).type.name;
        if (name === 'tableCell' || name === 'tableHeader') {
            const dom = view.nodeDOM($from.before(d));
            return dom && dom.nodeType === 1 ? dom : null;
        }
    }
    return null;
};

// —— 手柄定位：当前单元格右边线中间，骑跨边框；末列/贴视口右缘时收进单元格内 ——
// 尺寸随页面 zoom 缩放（手柄在 body 下不被 CSS zoom 影响，须手动乘）
// ⚠ 与 editor.css .cell-handle/.table-handle 尺寸同源——改一边必须改另一边，否则定位算式的居中假设失效
const HANDLE_W = 14;
const HANDLE_H = 26;
const TABLE_HANDLE = 16;
const positionHandle = () => {
    if (!pendingRect) return;
    const lr = layerRect();
    const offX = lr ? lr.left : 0;
    const offY = lr ? lr.top : 0;
    const boundR = lr ? lr.right : window.innerWidth; // 有层钳编辑器可视区右缘；无层钳窗口（旧行为）
    const w = HANDLE_W * zoom.value;
    const h = HANDLE_H * zoom.value;
    let left = pendingRect.right - w / 2;
    if (left + w > boundR - 8) left = pendingRect.right - w - 4;
    const top = pendingRect.top + pendingRect.height / 2 - h / 2;
    pos.value = { left: Math.round(left - offX), top: Math.round(top - offY) };
};

const update = () => {
    if (!props.editor || props.editor.isDestroyed) return;
    const show = props.editor.isActive('table') && props.editor.isEditable;
    if (!show) {
        visible.value = false;
        tableVisible.value = false;
        selRect.value = null;
        hideMenus();
        return;
    }
    try {
        const { state, view } = props.editor;
        // 实测页面 zoom：rect=缩放后显示值 / offsetWidth=未缩放布局值（坑 #35 坐标系），屏外节 offsetWidth=0 时保持旧值
        const domRect = view.dom.getBoundingClientRect();
        if (view.dom.offsetWidth > 0) zoom.value = domRect.width / view.dom.offsetWidth;
        // 选区模式 + 合并格检测（动态菜单依据）
        const sel = state.selection;
        if (sel instanceof CellSelection) {
            selMode.value = sel.isRowSelection() ? 'row' : sel.isColSelection() ? 'col' : 'block';
            let m = false;
            sel.forEachCell((n) => {
                if (n.attrs.colspan > 1 || n.attrs.rowspan > 1) m = true;
            });
            hasMerged.value = m;
        } else {
            selMode.value = 'cell';
            let m = false;
            const { $from } = sel;
            for (let d = $from.depth; d > 0; d--) {
                const n = $from.node(d);
                if ((n.type.name === 'tableCell' || n.type.name === 'tableHeader') && (n.attrs.colspan > 1 || n.attrs.rowspan > 1)) m = true;
            }
            hasMerged.value = m;
        }
        // 表格整体手柄：wrapper 左上角外侧（贴悬浮层/视口左缘时收进表内）；偏移量随 zoom 缩放
        const tinfo = findTable(sel.$from);
        const tdom = tinfo ? view.nodeDOM(tinfo.pos) : null;
        if (tdom && tdom.nodeType === 1) {
            const r = tdom.getBoundingClientRect();
            const lr = layerRect();
            const offX = lr ? lr.left : 0;
            const offY = lr ? lr.top : 0;
            tablePos.value = {
                left: Math.round(Math.max(offX + 4, r.left - (TABLE_HANDLE + 4) * zoom.value) - offX),
                top: Math.round(Math.max(offY + 4, r.top - 6 * zoom.value) - offY)
            };
            curAlign.value = tinfo.node.attrs.align ?? null;
            canFit.value = colwidthTotal(tinfo.node) != null;
            tableVisible.value = true;
        } else {
            tableVisible.value = false;
        }
        const sr = getSelectionRect(); // 多选：外包矩形（视口坐标——手柄锚点/钳制算式保持视口系）
        const cellDom = sr ? null : findCellDom();
        pendingRect = sr ?? (cellDom ? clampRect(cellDom.getBoundingClientRect(), cellDom) : null);
        // 描边覆盖层的渲染坐标才转层内系（减层偏移），出界交给层裁剪；pendingRect 不转，positionHandle 统一减
        const lr = layerRect();
        selRect.value = sr ? { ...sr, left: sr.left - (lr?.left ?? 0), top: sr.top - (lr?.top ?? 0) } : null;
        visible.value = !!pendingRect;
        nextTick(positionHandle);
    } catch {
        visible.value = false;
        tableVisible.value = false;
        selRect.value = null;
    }
};

// 滚动时：收起弹出菜单（overlay 不跟踪锚点），手柄/外框则随单元格重定位——
// 不能整体隐藏：focus() 自动滚动 caret 也会触发 scroll，隐藏会导致手柄在执行菜单命令后消失
let scrollRaf = false;
const onScroll = () => {
    hideMenus();
    if (scrollRaf) return;
    scrollRaf = true;
    requestAnimationFrame(() => {
        scrollRaf = false;
        update();
    });
};

// zoom 变化不触发编辑器事务（Ctrl+滚轮/宿主缩放/小屏自适应）——补监听让手柄缩放即时跟随
const onWheel = (e) => { if (e.ctrlKey) onScroll(); };
const onResize = () => onScroll();
const pageZoom = inject('pageZoom', null); // SectionedEditor 提供的 zoom getter（下拉里改 zoom 也即时生效）
if (pageZoom) watch(pageZoom, () => onScroll());

onMounted(() => {
    props.editor.on('selectionUpdate', update);
    props.editor.on('transaction', update);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    // 悬浮层尺寸/位置变化（宿主 splitter 拖拽不触发 window resize）也要重定位
    watch(
        () => floatingLayer?.value,
        (el) => {
            layerRO?.disconnect();
            layerRO = el ? new ResizeObserver(() => onScroll()) : null;
            if (el) layerRO.observe(el);
        },
        { immediate: true }
    );
});
let layerRO = null;
onBeforeUnmount(() => {
    props.editor.off('selectionUpdate', update);
    props.editor.off('transaction', update);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('resize', onResize);
    layerRO?.disconnect();
});
</script>

<template>
    <!-- 手柄/外框 Teleport 到悬浮层（SectionedEditor 提供）：坐标为层内系（视口 rect 减层偏移），
         出编辑器可视区被层 overflow 像素级裁断，不再穿透左侧目录树（2026-09-22）；
         层不存在时回退 body + fixed 旧行为。getBoundingClientRect 是视口坐标（缩放后），
         留在 zoom 容器内会被 zoom 二次缩放（坑 #35）——悬浮层在 zoom 容器外，安全 -->
    <Teleport :to="floatingLayer ?? 'body'">
    <!-- 多选单元格：选区整体外边框高亮（覆盖层描边，pointer-events 无） -->
    <div
        v-if="selRect" class="cell-selection-outline"
        :style="{ left: selRect.left + 'px', top: selRect.top + 'px', width: selRect.width + 'px', height: selRect.height + 'px', position: floatingLayer ? 'absolute' : 'fixed' }"
    ></div>
    <!-- 表格整体手柄（左上角，Notion 同款）：对齐/适应版心/删表（无 tooltip，简洁）；
         transform: scale(zoom) 跟随页面缩放（Teleport 出 zoom 容器后 CSS zoom 不再作用于它） -->
    <div
        v-if="tableVisible" class="table-handle"
        :style="{ left: tablePos.left + 'px', top: tablePos.top + 'px', transform: `scale(${zoom})`, position: floatingLayer ? 'absolute' : 'fixed' }"
        @mousedown.stop.prevent @click.stop="tableMenuRef?.toggle($event)"
    >
        <i class="pi pi-th-large"></i>
    </div>
    <TieredMenu ref="tableMenuRef" :model="tableItems" popup>
        <template #item="{ item, props: itemProps, hasSubmenu }">
            <a class="p-tieredmenu-item-link" v-bind="itemProps.action">
                <span v-if="item.dot" class="tm-dot" :style="{ background: item.dot }"></span>
                <span v-else class="p-tieredmenu-item-icon" :class="item.icon"></span>
                <span class="p-tieredmenu-item-label">{{ item.label }}</span>
                <i v-if="hasSubmenu" class="pi pi-angle-right p-tieredmenu-submenu-icon"></i>
            </a>
        </template>
    </TieredMenu>
    <!-- 手柄：mousedown.prevent 保编辑器焦点；.stop 阻止冒泡触发菜单的 outside-click 关闭（否则第二次开合会被误关） -->
    <div
        v-if="visible" class="cell-handle"
        :style="{ left: pos.left + 'px', top: pos.top + 'px', transform: `scale(${zoom})`, position: floatingLayer ? 'absolute' : 'fixed' }"
        @mousedown.stop.prevent @click.stop="toggleMenu"
    >
        <i class="pi pi-ellipsis-v"></i>
    </div>
    </Teleport>
    <TieredMenu ref="menuRef" :model="items" popup>
        <template #item="{ item, props: itemProps, hasSubmenu }">
            <a class="p-tieredmenu-item-link" v-bind="itemProps.action">
                <span v-if="item.dot" class="tm-dot" :style="{ background: item.dot }"></span>
                <span v-else class="p-tieredmenu-item-icon" :class="item.icon"></span>
                <span class="p-tieredmenu-item-label">{{ item.label }}</span>
                <i v-if="hasSubmenu" class="pi pi-angle-right p-tieredmenu-submenu-icon"></i>
            </a>
        </template>
    </TieredMenu>
</template>
