/**
 * 页面几何引擎 —— 编辑态与打印渲染共用的**唯一**几何来源（纯函数，零 DOM）。
 *
 * 历史教训（坑 #37/#38、幻影页、分页点漂移）：页面几何曾散落在 SectionEditor（pageH）、
 * render-server（margin/帧原点）、CSS（sheet padding/条定位）三处各自计算，数值漂移即出 bug。
 * 现在所有派生值只从 computePageLayout 一处算出，两侧 import 同一函数，不可能再漂移。
 *
 * 页面模型（A3/A4 固定集，加新型号 = PAGE_DIMS_MM 加一行）——四段带堆叠：
 *   纸顶 → 页边距(空白) → 页眉带(自带padding,随内容撑高) → 正文padding-top → 正文
 *        → 正文padding-bottom → 页脚带(自带padding) → 页边距(空白) → 纸底
 *   页边距是独立空白、**不含**页眉页脚；带 padding 住在 .hf CSS 盒内（编辑/打印同源），
 *   实测"内容高"= 整盒高（含带 padding）→ band 高 = 实测高，引擎不用单独加带 padding。
 *   页眉/页脚可缺省：带高=0 不占空间。左右无正文 padding——左右页边距即版心边界。
 *   一页正文高 = 纸高 − 上合成(边距+页眉带+正文pad) − 下合成 = Chromium 打印内容区（逐像素一致）。
 */
export const mmToPx = (mm) => Math.round((mm * 96) / 25.4);
export const pxToMm = (px) => (px * 25.4) / 96;

export const PAGE_DIMS_MM = {
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 }
};

/** 基础页边距（mm）：纸张边缘的独立空白（紧凑默认，节级可覆盖） */
export const BASE_MARGINS_MM = { top: 5, bottom: 5, left: 15, right: 15 }; // 左右 20→15（用户 2026-08-28：页边距缩小一点，版心 170→180mm）
/** 正文上下 padding 默认（mm）：页眉带/页脚带与正文之间的固定间距 */
export const BASE_BODY_PAD_MM = { top: 6, bottom: 6 };
/** 页间灰缝高（px，编辑态 .vp-gap-band 高度，改它要同步 editor.css） */
export const GAP_BAND_PX = 28;

/** 纸张实际宽高（含方向），返回 mm */
export const paperSizeMm = (pageSize, orientation) => {
    const d = PAGE_DIMS_MM[pageSize] || PAGE_DIMS_MM.A4;
    return orientation === 'landscape' ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
};

/**
 * 计算一页的完整几何。
 * @param {object} spec
 * @param {string} spec.size        'A4' | 'A3'（缺省 A4）
 * @param {string} spec.orientation 'portrait' | 'landscape'
 * @param {object} [spec.marginsMm]  节级页边距覆盖（合并到 BASE_MARGINS_MM）
 * @param {object} [spec.bodyPadMm]  节级正文上下 padding 覆盖（合并到 BASE_BODY_PAD_MM）
 * @param {number} [spec.headerHeightPx] 页眉带实测整盒高（px，含带 padding；0=无页眉带）
 * @param {number} [spec.footerHeightPx] 页脚带实测整盒高（px；0=无页脚带）
 * @returns 全派生值（px 供编辑态，mm 供 page.pdf margin；不变量：
 *          pageContentHeightPx + marginsPx.top + marginsPx.bottom ≈ paperPx.h（±1px 为 96dpi 舍入残差），
 *          pagePitchPx === paperPx.h + GAP_BAND_PX）
 */
export function computePageLayout({ size = 'A4', orientation = 'portrait', marginsMm, bodyPadMm, headerHeightPx = 0, footerHeightPx = 0 } = {}) {
    const base = { ...BASE_MARGINS_MM, ...(marginsMm || {}) };
    const bodyPad = { ...BASE_BODY_PAD_MM, ...(bodyPadMm || {}) };
    const paperMm = paperSizeMm(size, orientation);
    const paperPx = { w: mmToPx(paperMm.w), h: mmToPx(paperMm.h) };

    // 分段（px，编辑态直接用原值求和，不走 mm 往返——间隙各段之和必须恒等于 G）
    const marginTopPx = mmToPx(base.top);
    const marginBottomPx = mmToPx(base.bottom);
    const bodyPadTopPx = mmToPx(bodyPad.top);
    const bodyPadBottomPx = mmToPx(bodyPad.bottom);

    // 合成上边距 = 页边距 + 页眉带 + 正文上padding（下边距同理）——页眉页脚变高自然顶推正文
    const topPx = marginTopPx + headerHeightPx + bodyPadTopPx;
    const bottomPx = marginBottomPx + footerHeightPx + bodyPadBottomPx;
    // pdf() margin 只收 mm：合成值整体转 mm；一页正文高按 mm 相减再换算（= Chromium 打印内容区取整，
    // 先转 px 再相减会累积 ±1px 舍入差），编辑/打印两侧必须按同一约定取值
    const marginsMmOut = {
        top: pxToMm(topPx),
        bottom: pxToMm(bottomPx),
        left: base.left,
        right: base.right
    };
    const marginsPx = {
        top: topPx,
        bottom: bottomPx,
        left: mmToPx(base.left),
        right: mmToPx(base.right)
    };

    const contentWidthPx = paperPx.w - marginsPx.left - marginsPx.right;
    const pageContentHeightPx = mmToPx(paperMm.h - marginsMmOut.top - marginsMmOut.bottom);
    return {
        size,
        orientation,
        paperMm,
        paperPx,
        marginsMm: marginsMmOut,
        marginsPx,
        // 分段值：间隙家具/条定位按段拼装，之和恒等于 marginsPx/gapHeightPx（不经过 mm 舍入）
        marginTopPx,
        marginBottomPx,
        bodyPadTopPx,
        bodyPadBottomPx,
        headerBandPx: headerHeightPx,
        footerBandPx: footerHeightPx,
        contentWidthPx,
        contentWidthMm: paperMm.w - base.left - base.right,
        pageContentHeightPx,
        gapHeightPx: topPx + bottomPx + GAP_BAND_PX, // 页间隙家具总高 G（软分页造空间用）
        headerBarTopCss: `${marginTopPx}px`, // 页眉条 top = 上边距（带顶=边距底）
        footerBarTopCss: `calc(100% - ${marginBottomPx + footerHeightPx}px)`, // 页脚带底距纸底=下边距
        // 打印帧内偏移：页眉模板帧顶=纸顶 → 下推上边距；页脚模板帧顶=下合成区顶 → 下推正文下padding（带钉帧底方向）
        headerFrameOffsetPx: marginTopPx,
        footerFrameOffsetPx: bodyPadBottomPx,
        pagePitchPx: paperPx.h + GAP_BAND_PX // 页距（整页模型：每页占高恒=纸高，灰缝恰在纸界）
    };
}
