<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NodeSelection } from '@tiptap/pm/state';
import TieredMenu from 'primevue/tieredmenu';

/**
 * 图片浮动工具条（点击图片选中后浮出，Word 同款交互）：
 * - 对齐：靠左 / 居中 / 靠右（image 节点 align 属性，inline style 输出 → 定版一致）
 * - 缩放：−10% / +10% 步进 + 百分比档位菜单（25/50/75/100%/原始尺寸），width 为纸张内容宽百分比
 * - 裁剪：【就地裁剪态，不弹窗】点裁剪图标后节点临时渲染完整原图，选区外压暗、8 个控制点
 *   （4 角 + 4 边）直接压在图上拖拽调整窗口、窗口内拖动平移；**不破坏 src**——裁剪只写
 *   crop 属性（原图像素坐标），原图完整保留在 JSON 里，二次进入可基于全图再调整；
 *   完成/点击别处/Esc 提交一次事务，取消恢复原裁剪
 * - 删除图片
 * 定位：fixed 锚定图片右上角，整条随 zoom 等比缩放（尺寸观感与纸面一致），
 * 水平/垂直都钳在纸面（.sheet）内不飘出页面；滚动/zoom 变化 rAF 重定位。
 */
const props = defineProps({
    editor: { type: Object, required: true },
    zoom: { type: Number, default: 1 } // 条随 zoom 等比缩放 + zoom 变化重定位（用户 2026-09-04：条大小要合适、不飘出页面）
});

const visible = ref(false);
const pos = ref({ left: 0, top: 0, below: false });
const cur = ref({ align: 'center', width: null }); // 当前选中图片的属性（驱动按钮高亮/百分比显示）
const sizeMenuRef = ref(null);
let imgRect = null;

// 悬浮层（2026-09-22 穿透修复，与 TableFloatingMenu 同款）：SectionedEditor 提供的裁剪层。
// 有层：Teleport 进层、渲染坐标存层内系（视口 rect 减层 rect），出界被层 overflow 裁断；
// 无层：回退 body + fixed 旧行为。imgRect 保持视口系（positionBar 的钳纸面算式不动），
// 只在最终写入 pos/cropImgRect（渲染用）时减层偏移
const floatingLayer = inject('floatingLayer', null);
const layerRect = () => floatingLayer?.value?.getBoundingClientRect() ?? null;

// —— 选中态跟踪：NodeSelection 落在可浮动节点上才显示 ——
// cadDrawing（2026-09-23）与 image 同构（width/align/crop 属性 + <img> DOM），对齐/缩放/裁剪/删除通吃
const FLOATABLE_TYPES = ['image', 'cadDrawing'];
const update = () => {
    const ed = props.editor;
    if (!ed || ed.isDestroyed) return hide();
    const sel = ed.state.selection;
    if (!(ed.isEditable && sel instanceof NodeSelection && FLOATABLE_TYPES.includes(sel.node.type.name))) {
        // 裁剪态中点击别处 = 提交（Word 同款）
        if (cropping.value) finishCrop();
        return hide();
    }
    try {
        const dom = ed.view.nodeDOM(sel.from);
        imgRect = dom?.getBoundingClientRect() ?? null;
        if (!imgRect || !imgRect.width) return hide();
        cur.value = { align: sel.node.attrs.align || 'center', width: sel.node.attrs.width };
        if (cropping.value) {
            // 裁剪态覆盖层渲染坐标存层内系（悬浮层穿透修复 2026-09-22）
            const lr = layerRect();
            cropImgRect.value = { left: imgRect.left - (lr?.left ?? 0), top: imgRect.top - (lr?.top ?? 0), width: imgRect.width, height: imgRect.height };
        }
        visible.value = true;
        nextTick(positionBar);
    } catch {
        hide();
    }
};
const hide = () => {
    visible.value = false;
    sizeMenuRef.value?.hide();
};

// 条贴在图片右上角上方（水平右对齐图片右缘）；贴近纸面顶时翻到图片下方。
// 条随 zoom 等比缩放（transform: scale，JS 按缩放后尺寸定位），水平/垂直都钳在纸面（.sheet）内——
// 窄图/贴边图/低 zoom 下条不飘出页面（用户 2026-09-04）
const menuRef = ref(null);
const positionBar = () => {
    if (!imgRect) return;
    const z = props.zoom || 1;
    const bw = (menuRef.value?.offsetWidth ?? 220) * z; // offset* 是缩放前布局尺寸，乘 zoom=屏幕尺寸
    const bh = (menuRef.value?.offsetHeight ?? 34) * z;
    const page = props.editor.view.dom.closest('.sheet')?.getBoundingClientRect();
    const minL = (page ? page.left : 0) + 4;
    const maxL = Math.max(minL, (page ? page.right : window.innerWidth) - bw - 4);
    const pageTop = (page ? page.top : 0) + 4;
    const pageBottom = (page ? page.bottom : window.innerHeight) - 4;
    const below = imgRect.top - bh - 6 < pageTop;
    const lr = layerRect(); // 渲染坐标减层偏移转层内系（悬浮层穿透修复 2026-09-22）；钳制语义（纸面内）不变
    const offX = lr?.left ?? 0;
    const offY = lr?.top ?? 0;
    pos.value = {
        left: Math.round(Math.min(Math.max(imgRect.right - bw, minL), maxL) - offX),
        top: Math.round((below ? Math.min(imgRect.bottom + 6, pageBottom - bh) : imgRect.top - bh - 6) - offY),
        below
    };
};

const cmd = (attrs) => {
    // 节点实名：cadDrawing 与 image 属性同名（width/align/crop），按选区节点类型写回
    const type = props.editor.state.selection?.node?.type?.name;
    if (!type) return;
    props.editor.chain().focus().updateAttributes(type, attrs).run();
    nextTick(update); // 对齐/缩放改变图片盒尺寸，重定位
};
const setAlign = (a) => cmd({ align: a });
const setWidth = (w) => cmd({ width: w }); // w: 百分比数字 | null=原始尺寸
const stepWidth = (d) => {
    const w = cur.value.width ?? 100;
    setWidth(Math.min(100, Math.max(10, Math.round((w + d) / 5) * 5)));
};
const removeImage = () => props.editor.chain().focus().deleteSelection().run();

const sizeItems = [
    ...[25, 50, 75, 100].map((w) => ({
        label: `${w}% 纸宽`,
        command: () => setWidth(w)
    })),
    { separator: true },
    { label: '原始尺寸（自适应）', command: () => setWidth(null) }
];

// ============ 就地裁剪态（Word 同款：控制点直接压在图上拖，原图保留） ============
const cropping = ref(false);
const cropWin = ref(null); // 裁剪窗口（原图像素坐标）{ x, y, w, h }——拖拽只改它，完成时一次性提交
const cropNat = ref(null); // 原图自然尺寸 { natW, natH }
const cropImgRect = ref(null); // 完整原图的显示矩形（悬浮层内坐标=视口 rect 减层偏移，无层时=视口坐标；裁剪态期间不变）
let cropSnap = null; // 进入裁剪态时的 crop 快照（取消时恢复）
let cropPos = -1; // 被裁剪节点的文档位置（提交用 setNodeMarkup，不依赖提交时的选区状态）
let cropDrag = null; // { mode, sx, sy } 拖拽状态机

// 8 向控制点：4 角 + 4 边（Word 同款黑色方点）
const CROP_HANDLES = [
    { k: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
    { k: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
    { k: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
    { k: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
    { k: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
    { k: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
    { k: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
    { k: 'w', cursor: 'ew-resize', x: 0, y: 0.5 }
];
const CROP_MIN = 8; // 最小裁剪窗口（位图原图像素）
// 最小窗口随坐标系缩放：CAD 预览的"原图单位"是 SVG viewBox 单位（米制图纸可能只有个位数）——
// 硬下限 8 会把窗口钳回全图、裁剪恒失效（debug-cad-drawing 踩过）；位图仍守 8px
const cropMinSize = () => {
    const n = cropNat.value?.natW ?? 100;
    return Math.min(CROP_MIN, Math.max(0.001, n * 0.02));
};

// 显示比例：完整原图显示宽 / 原图像素宽。裁剪态期间原图盒尺寸不变 → 比例恒定，拖拽数学精确
const cropScale = computed(() => (cropImgRect.value && cropNat.value ? cropImgRect.value.width / cropNat.value.natW : 1));

// 覆盖层几何：裁剪窗口的视口矩形 = 原图矩形 + 窗口像素坐标 × 显示比例
const cropOverlay = computed(() => {
    if (!cropping.value || !cropImgRect.value || !cropWin.value) return null;
    const r = cropImgRect.value;
    const s = cropScale.value;
    const w = cropWin.value;
    return {
        frame: { left: r.left, top: r.top, width: r.width, height: r.height }, // 完整原图（压暗裁剪到此范围）
        win: { left: r.left + w.x * s, top: r.top + w.y * s, width: w.w * s, height: w.h * s }
    };
});

// 按进入时锁定的节点位置提交 crop（不依赖提交瞬间的选区——点别处提交时选区已不在图片上）
const applyCrop = (pos, crop) => {
    const ed = props.editor;
    const node = ed.state.doc.nodeAt(pos);
    if (!node || !FLOATABLE_TYPES.includes(node.type.name)) return;
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, crop }));
};

const enterCrop = () => {
    const ed = props.editor;
    const sel = ed.state.selection;
    const c = sel.node.attrs.crop;
    // 原图自然尺寸：已裁过的从属性拿；未裁过的节点还是 <img>，读 naturalWidth
    const dom = ed.view.nodeDOM(sel.from);
    const natW = c?.natW || dom?.naturalWidth;
    const natH = c?.natH || dom?.naturalHeight;
    if (!natW || !natH) return; // 图片尚未加载完
    cropNat.value = { natW, natH };
    cropSnap = c ? { ...c } : null;
    cropPos = sel.from;
    cropWin.value = c ? { x: c.x, y: c.y, w: c.w, h: c.h } : { x: 0, y: 0, w: natW, h: natH };
    cropping.value = true;
    document.addEventListener('keydown', onCropKey); // Enter 完成 / Esc 取消 / 其余按键拦截
    if (c) {
        // 已裁剪的节点是 background 窗口 div：先临时还原成完整原图，控制点才有完整边界可拖
        applyCrop(cropPos, null);
    }
    nextTick(update);
};

// 完成：窗口覆盖全图则视为未裁剪（crop=null），否则写 crop 属性（src 不动，原图保留）
const finishCrop = () => {
    const w = cropWin.value;
    const n = cropNat.value;
    if (!w || !n) return; // 已退出（重入保护）
    const identity = w.x === 0 && w.y === 0 && w.w === n.natW && w.h === n.natH;
    const crop = identity ? null : { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h), ...n };
    const changed = JSON.stringify(crop) !== JSON.stringify(cropSnap);
    const snap = cropSnap;
    const p = cropPos; // exitCrop 会清空 cropPos，先取出来
    // 先退出再提交事务：事务触发 update()，若 cropping 仍为 true 且选区已丢（点别处提交），会重入 finishCrop 死循环
    exitCrop();
    if (changed) applyCrop(p, crop);
    else if (snap) applyCrop(p, snap); // 没动过也要把临时还原的节点恢复
};
const cancelCrop = () => {
    const snap = cropSnap;
    const p = cropPos;
    exitCrop();
    if (snap) applyCrop(p, snap); // 恢复进入前的裁剪
};
const resetCrop = () => {
    cropWin.value = { x: 0, y: 0, w: cropNat.value.natW, h: cropNat.value.natH }; // 窗口拉回原图全幅（提交时即 crop=null）
};
const exitCrop = () => {
    cropping.value = false;
    cropWin.value = null;
    cropNat.value = null;
    cropImgRect.value = null;
    cropSnap = null;
    cropPos = -1;
    document.removeEventListener('keydown', onCropKey);
    nextTick(update);
};

// —— 控制点拖拽 / 窗口平移：只改本地 cropWin（无事务、零重排），完成时一次提交 ——
const onCropHandleDown = (k, e) => {
    e.preventDefault();
    e.stopPropagation();
    cropDrag = { mode: k, sx: e.clientX, sy: e.clientY };
    window.addEventListener('mousemove', onCropMove);
    window.addEventListener('mouseup', onCropUp);
};
const onCropWinDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    cropDrag = { mode: 'move', sx: e.clientX, sy: e.clientY };
    window.addEventListener('mousemove', onCropMove);
    window.addEventListener('mouseup', onCropUp);
};
const onCropMove = (e) => {
    if (!cropDrag || !cropWin.value) return;
    const s = cropScale.value;
    const dx = (e.clientX - cropDrag.sx) / s; // 显示像素 → 原图像素
    const dy = (e.clientY - cropDrag.sy) / s;
    cropDrag.sx = e.clientX;
    cropDrag.sy = e.clientY;
    const n = cropNat.value;
    let { x, y, w, h } = cropWin.value;
    const m = cropDrag.mode;
    if (m === 'move') {
        x = Math.min(Math.max(x + dx, 0), n.natW - w);
        y = Math.min(Math.max(y + dy, 0), n.natH - h);
    } else {
        const cmin = cropMinSize();
        if (m.includes('e')) w = Math.min(Math.max(w + dx, cmin), n.natW - x);
        if (m.includes('s')) h = Math.min(Math.max(h + dy, cmin), n.natH - y);
        if (m.includes('w')) { const nx = Math.min(Math.max(x + dx, 0), x + w - cmin); w += x - nx; x = nx; }
        if (m.includes('n')) { const ny = Math.min(Math.max(y + dy, 0), y + h - cmin); h += y - ny; y = ny; }
    }
    cropWin.value = { x, y, w, h };
};
const onCropUp = () => {
    cropDrag = null;
    window.removeEventListener('mousemove', onCropMove);
    window.removeEventListener('mouseup', onCropUp);
};
const onCropKey = (e) => {
    if (e.key === 'Escape') return cancelCrop(); // Esc = 放弃本次调整
    if (e.key === 'Enter') return finishCrop();
    // 裁剪态下其余按键一律拦截——NodeSelection 选中图片时打字会把图片替换成文本
    e.preventDefault();
    e.stopPropagation();
};

// 滚动：条随图片重定位（不整体隐藏，与表格手柄同因——命令引发的 focus 滚动不能把条弄丢）
let scrollRaf = false;
const onScroll = () => {
    sizeMenuRef.value?.hide();
    if (scrollRaf) return;
    scrollRaf = true;
    requestAnimationFrame(() => {
        scrollRaf = false;
        update();
    });
};

onMounted(() => {
    props.editor.on('selectionUpdate', update);
    props.editor.on('transaction', update);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
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
    window.removeEventListener('resize', onScroll);
    layerRO?.disconnect();
    document.removeEventListener('keydown', onCropKey);
    onCropUp();
});

// zoom 变化（Ctrl+滚轮/下拉档位）：图片 rect 全变，条须重定位 + 自身按新 zoom 缩放。
// 等 DOM 更新（section-wrapper 的 zoom 样式落盘）后再量，双 nextTick 太脆用 rAF 兜底
watch(
    () => props.zoom,
    () => nextTick(() => requestAnimationFrame(update))
);
</script>

<template>
    <!-- 工具条/裁剪覆盖层 Teleport 到悬浮层（SectionedEditor 提供）：坐标为层内系，出编辑器可视区
         被层 overflow 像素级裁断，不再穿透左侧目录树（2026-09-22）；层不存在时回退 body + fixed 旧行为。
         getBoundingClientRect 是视口坐标（缩放后），留在 zoom 容器内会被二次缩放（坑 #35）——悬浮层在 zoom 容器外，安全 -->
    <Teleport :to="floatingLayer ?? 'body'">
    <!-- 浮动工具条：mousedown.prevent 保住编辑器选区；随 zoom 等比缩放（transform-origin 左上，
         left/top 由 positionBar 按缩放后尺寸算出并钳在纸面内） -->
    <div
        v-if="visible" ref="menuRef" class="img-menu"
        :class="{ below: pos.below }"
        :style="{ left: pos.left + 'px', top: pos.top + 'px', transform: `scale(${zoom || 1})`, position: floatingLayer ? 'absolute' : 'fixed' }"
        @mousedown.prevent
    >
        <template v-if="!cropping">
            <button
                v-for="a in [
                    { icon: 'pi pi-align-left', v: 'left', tip: '靠左' },
                    { icon: 'pi pi-align-center', v: 'center', tip: '居中' },
                    { icon: 'pi pi-align-right', v: 'right', tip: '靠右' }
                ]"
                :key="a.v" v-tooltip.bottom="a.tip" class="img-btn" :class="{ on: cur.align === a.v }" @click="setAlign(a.v)"
            >
                <i :class="a.icon"></i>
            </button>
            <span class="sep"></span>
            <button v-tooltip.bottom="'缩小 10%'" class="img-btn" @click="stepWidth(-10)"><i class="pi pi-search-minus"></i></button>
            <button v-tooltip.bottom="'缩放档位'" class="img-btn img-size" @click="sizeMenuRef?.toggle($event)">
                {{ cur.width ?? '自适应' }}<template v-if="cur.width">%</template><i class="pi pi-angle-down"></i>
            </button>
            <button v-tooltip.bottom="'放大 10%'" class="img-btn" @click="stepWidth(10)"><i class="pi pi-search-plus"></i></button>
            <span class="sep"></span>
            <button v-tooltip.bottom="'裁剪'" class="img-btn" @click="enterCrop">
                <svg class="img-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M2 6h14a2 2 0 0 1 2 2v14" />
                </svg>
            </button>
            <button v-tooltip.bottom="'删除图片'" class="img-btn img-danger" @click="removeImage"><i class="pi pi-trash"></i></button>
            <TieredMenu ref="sizeMenuRef" :model="sizeItems" popup />
        </template>
        <!-- 裁剪态：条上只留完成/重置/取消（"拖控制点·原图保留"注释 2026-09-04 用户要求删） -->
        <template v-else>
            <button v-tooltip.bottom="'完成（Enter）'" class="img-btn img-label on" @click="finishCrop">完成</button>
            <button v-tooltip.bottom="'窗口拉回原图全幅'" class="img-btn img-label" @click="resetCrop">重置</button>
            <button v-tooltip.bottom="'取消（Esc）'" class="img-btn img-label" @click="cancelCrop">取消</button>
        </template>
    </div>

    <!-- 裁剪态覆盖层：完整原图范围内，窗口外压暗 + 窗口虚线框 + 8 控制点 -->
    <template v-if="cropOverlay">
        <!-- 压暗层：clip 到原图矩形，窗口 div 的超大 box-shadow 只染原图区域 -->
        <div
            class="crop-frame"
            :style="{ left: cropOverlay.frame.left + 'px', top: cropOverlay.frame.top + 'px', width: cropOverlay.frame.width + 'px', height: cropOverlay.frame.height + 'px', position: floatingLayer ? 'absolute' : 'fixed' }"
        >
            <div
                class="crop-win-shade"
                :style="{ left: cropOverlay.win.left - cropOverlay.frame.left + 'px', top: cropOverlay.win.top - cropOverlay.frame.top + 'px', width: cropOverlay.win.width + 'px', height: cropOverlay.win.height + 'px' }"
            ></div>
        </div>
        <!-- 窗口虚线框（可拖动平移） -->
        <div
            class="crop-win"
            :style="{ left: cropOverlay.win.left + 'px', top: cropOverlay.win.top + 'px', width: cropOverlay.win.width + 'px', height: cropOverlay.win.height + 'px', position: floatingLayer ? 'absolute' : 'fixed' }"
            @mousedown="onCropWinDown"
        ></div>
        <!-- 8 向控制点 -->
        <span
            v-for="hd in CROP_HANDLES" :key="hd.k" class="crop-handle"
            :style="{
                left: cropOverlay.win.left + hd.x * cropOverlay.win.width + 'px',
                top: cropOverlay.win.top + hd.y * cropOverlay.win.height + 'px',
                cursor: hd.cursor,
                position: floatingLayer ? 'absolute' : 'fixed'
            }"
            @mousedown="onCropHandleDown(hd.k, $event)"
        ></span>
    </template>
    </Teleport>
</template>
