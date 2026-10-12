<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

/**
 * Word 同款颜色下拉按钮（文字颜色/高亮色共用，用户 2026-09-04：原生 ColorPicker 鼠标选色太麻烦）：
 * - 点击弹出下拉色板：标准色一行 + 10 列 × 6 行渐变主题色 + 灰阶一行；
 * - 「自定义颜色…」展开色卡：R/G/B 数值输入（或十六进制）精确定位颜色，实时预览；
 * - 底部「最近使用」：localStorage 持久化（文字/高亮两个按钮共享一份，最多 10 个，最新在前）；
 * - 顶部「自动/无颜色」= 清除（emit null → unsetColor/unsetHighlight）。
 * 面板 Teleport 到 body + fixed 定位（工具栏折叠/溢出不会裁剪面板）；点外部/Esc/滚动/缩放关闭。
 */
const props = defineProps({
    type: { type: String, default: 'color' }, // 'color'=文字颜色 | 'highlight'=高亮色
    current: { type: String, default: '' }, // 当前选区颜色（#rrggbb 或空串）
    tip: { type: String, default: '' }
});
const emit = defineEmits(['apply']); // hex('#rrggbb') | null（清除）

// —— 色板数据 ——
const STANDARD = ['#ff0000', '#ff9900', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0', '#ff00ff'];
// 10 列色调（同族 6 行：3 浅 + 原色 + 2 深）
const HUES = ['#c00000', '#e36c0a', '#bf8f00', '#538135', '#375623', '#2e75b6', '#1f4e79', '#002060', '#5b2d90', '#c00078'];
const GRAY = ['#000000', '#262626', '#404040', '#595959', '#737373', '#8c8c8c', '#a6a6a6', '#bfbfbf', '#d9d9d9', '#f2f2f2'];
const hex2rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (hex, target, ratio) => {
    const a = hex2rgb(hex);
    const b = hex2rgb(target);
    return rgb2hex(...a.map((v, i) => v + (b[i] - v) * ratio));
};
// 每列：与白混 80/60/40% 三浅、原色、与黑混 25/50% 两深（Word 主题色同款明暗梯度）
const GRID = HUES.map((h) => [mix(h, '#ffffff', 0.8), mix(h, '#ffffff', 0.6), mix(h, '#ffffff', 0.4), h, mix(h, '#000000', 0.25), mix(h, '#000000', 0.5)]);

// —— 最近使用（localStorage 共享，两个按钮一份） ——
const RECENT_KEY = 'docEditorRecentColors';
const loadRecent = () => {
    try {
        const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(arr) ? arr.filter((c) => /^#[0-9a-f]{6}$/.test(c)) : [];
    } catch {
        return [];
    }
};
const recent = ref(loadRecent());
const pushRecent = (hex) => {
    recent.value = [hex, ...recent.value.filter((c) => c !== hex)].slice(0, 10);
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value));
    } catch { /* 隐私模式等写不进去就只在内存里 */ }
};

// —— 应用颜色 ——
const apply = (hex) => {
    if (hex) pushRecent(hex);
    emit('apply', hex);
    close();
};

// —— 自定义色卡（R/G/B 数值 ↔ 十六进制 双向同步，实时预览） ——
const customOpen = ref(false);
const r = ref(0);
const g = ref(0);
const b = ref(0);
const hexModel = ref('#000000');
let syncing = false;
const setFromHex = (hex) => {
    if (syncing) return;
    syncing = true;
    [r.value, g.value, b.value] = hex2rgb(hex);
    syncing = false;
};
const setFromRgb = () => {
    if (syncing) return;
    syncing = true;
    hexModel.value = rgb2hex(r.value, g.value, b.value);
    syncing = false;
};
watch(hexModel, () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexModel.value)) setFromHex(hexModel.value.toLowerCase());
});
watch([r, g, b], setFromRgb);
const openCustom = () => {
    const cur = /^#[0-9a-f]{6}$/.test(props.current) ? props.current : '#000000';
    syncing = true;
    hexModel.value = cur;
    [r.value, g.value, b.value] = hex2rgb(cur);
    syncing = false;
    customOpen.value = true;
};
const customPreview = () => (/^#[0-9a-fA-F]{6}$/.test(hexModel.value) ? hexModel.value : 'transparent');
const confirmCustom = () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexModel.value)) apply(hexModel.value.toLowerCase());
};

// —— 面板开合与定位（Teleport body + fixed，钳在视口内） ——
const open = ref(false);
const btnRef = ref(null);
const panelRef = ref(null);
const panelPos = ref({ left: 0, top: 0 });
const toggle = async () => {
    if (open.value) return close();
    recent.value = loadRecent(); // 两个按钮实例各自持有 ref——每次打开从 localStorage 重读，保证两边实时一致
    open.value = true;
    customOpen.value = false;
    await nextTick();
    const rect = btnRef.value?.getBoundingClientRect();
    const pw = panelRef.value?.offsetWidth ?? 230;
    const ph = panelRef.value?.offsetHeight ?? 320;
    panelPos.value = {
        left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - pw - 8)),
        top: Math.max(8, Math.min((rect?.bottom ?? 0) + 4, window.innerHeight - ph - 8))
    };
};
const close = () => {
    open.value = false;
    customOpen.value = false;
};
const onDocDown = (e) => {
    if (!open.value) return;
    if (panelRef.value?.contains(e.target) || btnRef.value?.contains(e.target)) return;
    close();
};
const onKey = (e) => e.key === 'Escape' && close();
const onScroll = () => close();
watch(open, (v) => {
    if (v) {
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
    } else {
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
    }
});
onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
});

const barColor = () => (props.current && /^#[0-9a-fA-F]{6}$/.test(props.current) ? props.current : props.type === 'highlight' ? '#ffff00' : '#000000');
</script>

<template>
    <button ref="btnRef" v-tooltip.bottom="tip" type="button" class="cp-btn" :class="{ open }" @click="toggle">
        <span class="cp-glyph-wrap">
            <i v-if="type === 'highlight'" class="pi pi-marker cp-glyph"></i>
            <span v-else class="cp-glyph cp-a">A</span>
            <span class="cp-bar" :style="{ background: barColor() }"></span>
        </span>
        <i class="pi pi-angle-down cp-caret"></i>
    </button>
    <Teleport to="body">
        <div v-if="open" ref="panelRef" class="cp-panel" :style="{ left: panelPos.left + 'px', top: panelPos.top + 'px' }" @mousedown.stop>
            <!-- 清除：文字颜色=自动（黑），高亮=无颜色 -->
            <button type="button" class="cp-clear" @click="apply(null)">
                <span class="cp-clear-box" :class="{ hl: type === 'highlight' }"></span>{{ type === 'highlight' ? '无颜色' : '自动' }}
            </button>
            <!-- 标准色一行 -->
            <div class="cp-row">
                <button
                    v-for="c in STANDARD" :key="c" type="button" class="cp-cell" :class="{ on: current === c }"
                    :style="{ background: c }" :title="c" @click="apply(c)"
                ></button>
            </div>
            <!-- 渐变主题色：10 列 × 6 行（同族 3 浅 + 原色 + 2 深） -->
            <div class="cp-grid">
                <div v-for="(col, ci) in GRID" :key="ci" class="cp-col">
                    <button
                        v-for="c in col" :key="c" type="button" class="cp-cell" :class="{ on: current === c }"
                        :style="{ background: c }" :title="c" @click="apply(c)"
                    ></button>
                </div>
            </div>
            <!-- 灰阶一行 -->
            <div class="cp-row">
                <button
                    v-for="c in GRAY" :key="c" type="button" class="cp-cell" :class="{ on: current === c }"
                    :style="{ background: c }" :title="c" @click="apply(c)"
                ></button>
            </div>
            <!-- 自定义色卡：R/G/B 数值或十六进制输入定位颜色，实时预览 -->
            <div v-if="!customOpen" class="cp-actions">
                <button type="button" class="cp-custom-btn" @click="openCustom"><i class="pi pi-palette"></i>自定义颜色…</button>
            </div>
            <div v-else class="cp-custom">
                <div class="cp-custom-row">
                    <span class="cp-preview" :style="{ background: customPreview() }"></span>
                    <label>R<input v-model.number="r" type="number" min="0" max="255" /></label>
                    <label>G<input v-model.number="g" type="number" min="0" max="255" /></label>
                    <label>B<input v-model.number="b" type="number" min="0" max="255" /></label>
                </div>
                <div class="cp-custom-row">
                    <input v-model="hexModel" class="cp-hex" type="text" maxlength="7" spellcheck="false" />
                    <button type="button" class="cp-ok" :disabled="!/^#[0-9a-fA-F]{6}$/.test(hexModel)" @click="confirmCustom">确定</button>
                    <button type="button" class="cp-cancel" @click="customOpen = false">取消</button>
                </div>
            </div>
            <!-- 最近使用（最下面，共享 localStorage） -->
            <template v-if="recent.length">
                <div class="cp-label">最近使用</div>
                <div class="cp-row">
                    <button
                        v-for="c in recent" :key="c" type="button" class="cp-cell" :class="{ on: current === c }"
                        :style="{ background: c }" :title="c" @click="apply(c)"
                    ></button>
                </div>
            </template>
        </div>
    </Teleport>
</template>
