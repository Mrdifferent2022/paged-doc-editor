import { computed } from 'vue';
import { computePageLayout } from './pageLayout.js';

/**
 * 页面几何引擎的 Vue 适配层：section + 页眉/页脚实测高 → layout computed。
 * 页眉/页脚高度由 HeaderFooterEditor 的 ResizeObserver 上报（ref），
 * 变高 → 有效边距自动撑高 → sheet padding / VP pageH 全部随之重算（宽度不变 → 高度收敛无循环）。
 */
export function usePageLayout(getSection, headerHeightPx, footerHeightPx) {
    return computed(() => {
        const s = getSection();
        return computePageLayout({
            size: s.pageSize,
            orientation: s.orientation,
            marginsMm: s.marginsMm,
            bodyPadMm: s.bodyPadMm,
            headerHeightPx: headerHeightPx.value || 0,
            footerHeightPx: footerHeightPx.value || 0
        });
    });
}
