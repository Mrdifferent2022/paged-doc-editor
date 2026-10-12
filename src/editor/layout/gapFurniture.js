/**
 * 页间隙家具纯工厂 —— 从 SectionEditor 抽出的 DOM 建造器，零 Vue 依赖。
 * 所有几何数值只从 layout（computePageLayout 输出）读取：编辑态间隙与打印帧同源，不可能漂移。
 *
 * 页间隙模型（四段带堆叠，整页分页，不是局部分页）——从上一页正文末尾到下一页正文开头：
 *   本页剩余空白(fill) → 正文下padding白条 → 页脚带(内含页脚条) → 下边距白条
 *   → 灰缝(纸间空隙，恰在纸界) → 上边距白条 → 页眉带(内含页眉条) → 正文上padding白条
 *   各段之和 = marginsPx.bottom + GAP_BAND_PX + marginsPx.top = G（不变量）；
 *   页眉/页脚缺省时对应带段高=0 直接跳过。
 *
 * 奇偶页：调用方按页码 resolveStories 后把原始 HTML（含 {page}/{pages} 占位）传进来，
 * 这里负责占位替换——页脚属于上一页(nextPageNo-1)，页眉属于下一页(nextPageNo)。
 */
import { GAP_BAND_PX } from './pageLayout.js';
import { fillHfPreview, blankPendingHfFields } from './stories.js';

/**
 * 造一个页间隙 DOM。
 * @param {object} o
 * @param {object} o.layout     computePageLayout 输出（分段值提供各白条/带高、横向 padding）
 * @param {string} [o.footerHtml] 上一页页脚原始 HTML（{page} 会替换为 nextPageNo-1）
 * @param {string} [o.headerHtml] 下一页页眉原始 HTML（{page} 会替换为 nextPageNo）
 * @param {number} o.nextPageNo  下一页的全局页码（页眉/页脚页码占位用）
 * @param {number} [o.totalPages] 全文总页数（{pages} 占位显示）
 * @param {number} [o.fillPx]    上一页未用尽的空白高（把页脚带推到页底 → 每页都是整页）
 */
export function renderGap({ layout, footerHtml = '', headerHtml = '', nextPageNo, totalPages = 0, fillPx = 0 }) {
    const { marginsPx } = layout;
    const wrap = document.createElement('div');
    wrap.className = 'vp-gap-inner';
    wrap.style.marginLeft = `-${marginsPx.left}px`;
    wrap.style.marginRight = `-${marginsPx.right}px`;
    const mk = (cls, html) => {
        const d = document.createElement('div');
        d.className = cls;
        d.style.paddingLeft = `${marginsPx.left}px`;
        d.style.paddingRight = `${marginsPx.right}px`;
        d.innerHTML = html;
        return d;
    };
    // 白条（纸面空白段：正文 padding / 页边距，与 sheet padding 同高同源）；
    // 带条：高度=实测整盒高，页眉/页脚条在内顶对齐（带 padding 在 .hf 盒内，与 sheet 条/打印帧三方一致）。
    // zoom 坐标系：块高/pageH 都是未缩放值，白条也不乘 zoom（坑 #35）
    const strip = (px, barEl, cls = 'vp-gap-margin') => {
        const d = document.createElement('div');
        d.className = cls;
        d.style.height = `${px}px`;
        if (barEl) d.appendChild(barEl);
        return d;
    };
    if (fillPx > 0) {
        // 本页未用尽的空白：保持纸面白色，把页脚带推到页底 → 每页都是整页
        const filler = document.createElement('div');
        filler.className = 'vp-gap-fill';
        filler.style.height = `${fillPx}px`;
        wrap.appendChild(filler);
    }
    // 上一页底部：正文下padding → 页脚带 → 下边距
    wrap.appendChild(strip(layout.bodyPadBottomPx));
    if (footerHtml && layout.footerBandPx > 0) {
        // 页脚占位字段置空显示（只隐藏 {{...}} 本体，标签与灰线照常）——与 sheet 预览条/打印模板同源
        // data-hf-parity：双击代理进编辑时按本条页码奇偶直接打开对应变体（页脚属于上一页=nextPageNo-1）
        const footBar = mk('vp-gap-hf vp-gap-footer hf footer', fillHfPreview(blankPendingHfFields(footerHtml), nextPageNo - 1, totalPages));
        footBar.dataset.hfParity = (nextPageNo - 1) % 2 === 0 ? 'even' : 'odd';
        wrap.appendChild(strip(
            layout.footerBandPx,
            footBar,
            'vp-gap-margin vp-gap-band-hf'
        ));
    }
    wrap.appendChild(strip(layout.marginBottomPx));
    // 灰缝（纸界）
    const band = document.createElement('div');
    band.className = 'vp-gap-band';
    band.style.height = `${GAP_BAND_PX}px`;
    wrap.appendChild(band);
    // 下一页顶部：上边距 → 页眉带 → 正文上padding
    wrap.appendChild(strip(layout.marginTopPx));
    if (headerHtml && layout.headerBandPx > 0) {
        // data-hf-parity：页眉属于下一页=nextPageNo（页码偶 → 双击直接开偶数变体）
        const headBar = mk('vp-gap-hf vp-gap-header hf header', fillHfPreview(headerHtml, nextPageNo, totalPages));
        headBar.dataset.hfParity = nextPageNo % 2 === 0 ? 'even' : 'odd';
        wrap.appendChild(strip(
            layout.headerBandPx,
            headBar,
            'vp-gap-margin vp-gap-band-hf'
        ));
    }
    wrap.appendChild(strip(layout.bodyPadTopPx));
    return wrap;
}

/** 末页填充：最后一页未用尽的空白，把 sheet 底部的页脚条钉在页底（末页也是整页） */
export function renderTail(fillPx) {
    const d = document.createElement('div');
    d.className = 'vp-tail-fill';
    d.style.height = `${fillPx}px`;
    return d;
}
