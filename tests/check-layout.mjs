/** 页面几何引擎单测（node 直跑）：A4/A3 × 纵/横 × 页眉页脚高 的全派生值断言 */
import { computePageLayout, mmToPx, GAP_BAND_PX } from '../src/editor/layout/pageLayout.js';
import { resolveStories, fillHfPreview } from '../src/editor/layout/stories.js';

const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const eq = (a, b, label) => { if (a !== b) fail(`${label}: ${a} !== ${b}`); };

// ---- 1. 默认版式（A4 纵向，无页眉页脚带）——四段带模型：边距5mm + 正文pad6mm ----
const a4 = computePageLayout({ size: 'A4', orientation: 'portrait' });
eq(a4.paperPx.w, 794, 'A4 纸宽');
eq(a4.paperPx.h, 1123, 'A4 纸高');
eq(a4.marginTopPx, mmToPx(5), 'A4 上边距段');
eq(a4.bodyPadTopPx, mmToPx(6), 'A4 正文上padding段');
eq(a4.marginsPx.top, mmToPx(5) + mmToPx(6), 'A4 上合成（无边距带）');
eq(a4.marginsPx.bottom, mmToPx(5) + mmToPx(6), 'A4 下合成（无页脚带）');
eq(a4.contentWidthPx, 794 - 57 - 57, 'A4 版心宽'); // 左右边距 15mm=57px
eq(a4.pageContentHeightPx, mmToPx(297 - a4.marginsMm.top - a4.marginsMm.bottom), 'A4 正文高=打印内容区');
eq(a4.gapHeightPx, a4.marginsPx.top + a4.marginsPx.bottom + GAP_BAND_PX, 'A4 间隙家具 G');
eq(a4.pagePitchPx, 1123 + GAP_BAND_PX, 'A4 页距');
eq(a4.headerBarTopCss, `${mmToPx(5)}px`, '页眉条 top=上边距');
eq(a4.footerBarTopCss, `calc(100% - ${mmToPx(5)}px)`, '无页脚带时页脚条 top=下边距');
eq(a4.headerFrameOffsetPx, mmToPx(5), '页眉打印帧偏移=上边距');
eq(a4.footerFrameOffsetPx, mmToPx(6), '页脚打印帧偏移=正文下padding');

// ---- 2. 不变量全组合：A4/A3 × 纵/横 × 页眉页脚带高 ----
for (const size of ['A4', 'A3']) {
    for (const orientation of ['portrait', 'landscape']) {
        for (const [hh, fh] of [[0, 0], [120, 0], [0, 90], [200, 150]]) {
            const L = computePageLayout({ size, orientation, headerHeightPx: hh, footerHeightPx: fh });
            // ±1px 容差：pageH 按 mm 空间相减再换算（=Chromium 打印内容区），与 px 舍入的合成值有 96dpi 舍入残差
            if (Math.abs(L.pageContentHeightPx + L.marginsPx.top + L.marginsPx.bottom - L.paperPx.h) > 1)
                fail(`不变量破: ${size}/${orientation}/hh=${hh}/fh=${fh}`);
            if (L.pagePitchPx !== L.paperPx.h + GAP_BAND_PX) fail(`页距不变量破: ${size}/${orientation}`);
            if (L.gapHeightPx !== L.marginsPx.top + L.marginsPx.bottom + GAP_BAND_PX) fail(`G 不变量破: ${size}`);
            // 自动撑高：带高直接顶推正文（合成 = 边距 + 带 + 正文padding，无额外缓冲）
            const expTop = mmToPx(5) + hh + mmToPx(6);
            if (L.marginsPx.top !== expTop) fail(`自动撑高 top: ${size} hh=${hh} → ${L.marginsPx.top} ≠ ${expTop}`);
            const expBottom = mmToPx(5) + fh + mmToPx(6);
            if (L.marginsPx.bottom !== expBottom) fail(`自动撑高 bottom: ${size} fh=${fh} → ${L.marginsPx.bottom} ≠ ${expBottom}`);
        }
    }
}
console.log('1 LAYOUT-OK 8 组合全过（含不变量/带高顶推）');

// ---- 3. A3 横向数值 ----
const a3l = computePageLayout({ size: 'A3', orientation: 'landscape' });
eq(a3l.paperPx.w, 1587, 'A3 横纸宽');
eq(a3l.paperPx.h, 1123, 'A3 横纸高');
eq(a3l.contentWidthPx, 1587 - 57 - 57, 'A3 横版心宽'); // 420mm=1587px 减左右 15mm

// ---- 4. 节级覆盖：页边距 + 正文 padding 各自可覆盖 ----
const custom = computePageLayout({ size: 'A4', orientation: 'portrait', marginsMm: { top: 30 } });
eq(custom.marginsPx.top, mmToPx(30) + mmToPx(6), '覆盖上边距（边距30+正文pad6）');
eq(custom.pageContentHeightPx, mmToPx(297 - custom.marginsMm.top - custom.marginsMm.bottom), '覆盖后正文高（mm 空间相减）');
const customPad = computePageLayout({ size: 'A4', orientation: 'portrait', bodyPadMm: { top: 10 } });
eq(customPad.marginsPx.top, mmToPx(5) + mmToPx(10), '覆盖正文上padding（边距5+pad10）');
console.log('2 OVERRIDE-OK 节级边距/正文padding覆盖生效');

// ---- 5. 奇偶故事选取（全局页码）----
const sec = { header: 'H奇', headerEven: 'H偶', footer: 'F奇' };
eq(resolveStories(sec, 1).header, 'H奇', '奇数页页眉');
eq(resolveStories(sec, 2).header, 'H偶', '偶数页页眉');
eq(resolveStories(sec, 4).footer, 'F奇', '偶数页页脚无变体回退奇数');
eq(resolveStories({ header: 'H' }, 2).header, 'H', '无 even 字段回退');
// ---- 6. 占位替换 ----
eq(fillHfPreview('第 {page}/{pages} 页', 3, 10), '第 3/10 页', '占位替换');
eq(fillHfPreview('第 {page} 页', null, 0).includes('‹页码›'), true, '空页码占位符');
console.log('3 STORIES-OK 奇偶选取 + 占位替换');

console.log('ALL PASS');
