/**
 * Tiptap JSON → 定版 PDF 渲染管线（可导入模块，单一来源）。
 * server/render-server.js 是 express 薄壳 HTTP 入口；宿主后端也可直接 import 本模块。
 *
 * 流程：按 section renderToHTMLString → 注入共享打印 CSS → puppeteer 分节渲染
 *       （各自纸张/方向/页眉页脚）→ pdf-lib 全局页码盖章 → 合并。
 *
 * 页面几何全部来自 layout/pageLayout.js 引擎（computePageLayout），与编辑态同一来源：
 * - 测量前置：隐藏页先量页眉/页脚实测高（版心宽只取决于左右边距，与撑高无关）→
 *   引擎算出有效边距（页眉页脚超高自动撑高 +4mm 缓冲）→ pdf() margin 用之 → 编辑/打印同帧。
 * - 奇偶页：节含 headerEven/footerEven 时两轮渲染——Pass1 奇数模板渲全部页拿页数 n，
 *   Pass2 偶数模板 pageRanges:'2,4,…'（内容+边距相同 → 分页逐页一致）→ pdf-lib 交错合并。
 * - 全局连续页码：Chromium 的 pageNumber/totalPages 在每次 page.pdf() 调用内计数，
 *   分节渲染会得到 1,2,1,2 的断号。故 {page}/{pages} 占位 → 隐藏的锚点 <span>（visibility:hidden，
 *   占布局不打印），再用 puppeteer 隐藏页在"模板帧"坐标系里量出锚点 rect（标定：模板视口=整页
 *   CSS-px，1px=0.75pt，页脚帧原点=下边距框顶），最后 pdf-lib 按节页数前缀和、按页码奇偶选
 *   锚点盖章全局页码。
 */
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { renderToHTMLString } from '@tiptap/static-renderer';
// 扩展清单 / 页面几何引擎 / 奇偶选取均来自编辑器包（单一来源，两侧自动一致）
import { buildExtensions } from '../editor/tiptap/index.js';
import { computePageLayout } from '../editor/layout/pageLayout.js';
import { resolveStories, blankPendingHfFields } from '../editor/layout/stories.js';
import { labelsOf } from '../editor/templates/standardTemplate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTENSIONS = buildExtensions();

let sharedCss = '';
let digitFontBytes = null; // Noto Serif 数字子集（0-9，~2.5KB）：页码盖章用，替换 Helvetica（与衬线正文同族）

/** 启动时调用一次：读共享打印 CSS + 数字子集字体 */
export async function initRender() {
    sharedCss = await readFile(path.join(__dirname, '../editor/styles/editor.css'), 'utf-8');
    digitFontBytes = await readFile(path.join(__dirname, 'assets/notoserif-digits.ttf'));
}

// puppeteer 是 optionalDependency：只用前端编辑器库的宿主不必装 Chromium，
// 首次渲染时才动态 import，缺失时给出可操作的报错
let puppeteerMod = null;
async function loadPuppeteer() {
    if (puppeteerMod) return puppeteerMod;
    try {
        puppeteerMod = (await import('puppeteer')).default;
    } catch {
        throw new Error(
            'paged-doc-editor: PDF rendering requires the optional dependency "puppeteer". ' +
            'Install it with: npm install puppeteer'
        );
    }
    return puppeteerMod;
}

/**
 * 页眉/页脚模板：接收已填充参数的 HTML（{{stdName}} 等已在实例化时替换），
 * 这里处理 {page}/{pages} 页码占位 + 未签章占位兜底。
 * 注意：puppeteer 的 header/footerTemplate 是独立文档，不继承页面 CSS，必须内联样式。
 * {page}/{pages} → 隐藏锚点（visibility:hidden：占布局、不打印），数字由 pdf-lib 盖章（全局连续页码）。
 * 节数据存的是"内部内容"，.hf 上下文包装由本函数提供（编辑态由 sheet 条/页间隙条容器提供，三处一致；
 * 与 editor.css 的 .hf 规则互指——改样式两边同步）。
 */
const HF_STYLE = `<style>
html, body { margin: 0; padding: 0; } /* 锁死模板文档布局：与锚点测量页逐像素一致 */
*, *::before, *::after { box-sizing: border-box; } /* 与编辑态 editor.css 全局 reset 对齐：
    缺它时 td 走 content-box，四列百分比内容宽合计 100% 再加 padding/border 超出表宽 → Chrome fixed 布局把所有列
    等比缩 ~7%，标题格内容宽比编辑态窄 ~7px → 临界长度的页眉标题编辑态一行、导出折两行。补上后列分配与编辑态逐像素一致 */
.hf { width: 100%; font-size: 9pt; color: #444; font-family: SimSun, '宋体', serif; } /* 全文档宋体（2026-08-27 用户定）：与正文/editor.css 三处一致 */
.hf p { margin: 0; } /* PM 规范化 td 内 <p> 的 UA 1em margin 归零（与编辑态同款，否则条高差 24px） */
.hf.header { padding-top: 3mm; padding-bottom: 2mm; font-size: 11pt; } /* 页眉字号=正文 11pt（2026-09-07 用户：页眉正文同步 12→11）。带 padding 与编辑态 editor.css 互指；无分隔线（标题栏表格下边框即分隔） */
.hf-head { width: 100%; border-collapse: collapse; table-layout: fixed; } /* 旧版单行页眉（存量文档兼容） */
.hf-head td { padding: 0; }
.hf-c { text-align: center; }
.hf-r { text-align: right; }
.hf-std-name { font-weight: 600; }
/* 页眉标题栏（3列×2行网格，docs/标准标题.png，2026-09-07 改版：章节行入中列、QR 并入版本格同格）——与 editor.css 的 .hf .hf-title 互指，改样式两边同步 */
.hf-title { width: 100%; border-collapse: collapse; table-layout: fixed; color: #000; }
.hf-title td { border: 1px solid #999; padding: 1pt 4pt; height: 8.5mm; vertical-align: middle; overflow-wrap: anywhere; } /* 行高 6.5→7.5→8.5mm（2026-08-28） */
.hf-title .hf-logo { display: inline-block; width: 4.5mm; height: 4.5mm; vertical-align: -0.8mm; margin-right: 1.2mm; } /* 公司格 logo（currentColor）；inline-block 防全局 CSS 覆盖；对齐零点取 -0.8mm */
.hf-title .hf-company { width: 29%; font-weight: 700; white-space: nowrap; } /* nowrap 钉死一行；11pt 实测 171px+取整余量 → 29%（debug-header-widths 定稿） */
.hf-title .hf-doc { width: 52%; font-weight: 700; } /* 行1：整份标准文件大名称（stdNo+stdName）一行；zh 随页眉基准 11pt（用户 2026-09-07），EN 覆写 9pt；余量留给长标题 */
.hf-title .hf-chap { font-weight: 700; } /* 行2：章节号+章节名称（字号随页眉基准）；列宽继承同列 .hf-doc */
.hf-title td.hf-doc { border-bottom: none; } /* 中列两行间分隔线隐藏（2026-09-07 用户要求）；border-collapse 上下两格都须 none */
.hf-title td.hf-chap { border-top: none; }
.hf-title .hf-page { width: 19%; font-weight: 700; white-space: nowrap; } /* 页码格加粗+nowrap：两位数页码平铺一行；11pt 实测 120px=17.6% + 余量 → 19% */
.hf-title .hf-qr { display: inline-block; width: 7mm; height: 7mm; vertical-align: middle; } /* 与版本号同格（2026-09-07）；7mm 贴 8.5mm 行高（用户试过 1cm 嫌大）；inline-block 防全局 CSS */
.hf-title .hf-ver { font-weight: 700; } /* 版本号 V001 加粗 + 同格二维码 */
.hf-title .hf-dept { font-weight: 700; }
.hf.footer { padding-top: 2mm; padding-bottom: 3mm; } /* 无 border-top：灰线画在内容段落 .foot-line 上（各页都在页边距内） */
.foot-line { border-top: 1px solid #999; padding-top: 1.5mm; line-height: 6mm; } /* line-height=签名图高：奇偶页灰线纵坐标一致 */
.sig-strip { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
.sig-strip td { border: 1px solid #999; padding: 1pt 4pt; text-align: center; height: 9mm; vertical-align: middle; }
.sig-strip .sig-role { background: #f0f2f5; }
.sig-strip .sig-val { color: #1d4ed8; }
.sig-img { display: inline-block; height: 5.5mm; vertical-align: -1.4mm; } /* inline-block 防全局 CSS 覆盖；<行高6mm：图不撑大行盒，奇偶页脚同高（灰线对齐）；-1.4mm 让签名文字基线对齐标签基线；与 editor.css 互指 */
/* 定宽占位槽：签章/传参前后标签位置不跳；槽宽≥内容宽（签名图 17.7mm 恒定、日期≈16mm、邮箱按默认公共邮箱 48mm）。与 editor.css 互指 */
.sig-slot { display: inline-block; width: 18mm; }
.date-slot { display: inline-block; width: 18mm; }
.email-slot { display: inline-block; width: 48mm; } /* 默认公共邮箱 44.4mm 实测宽 + 3.6mm 余量 */
</style>`;

// 英文文档字体栈（用户 2026-09-02 定 Times 优先）：与 editor.css 的 .lang-en 规则同源同栈，
// SimSun 兜底缺字形/残留中文。页眉页脚模板是独立文档不含 sharedCss，必须在这里内联补。
// EN 页眉 10pt（中列标准标题太窄，整体字体变小让空间；正文仍 11pt）：
// 公司格 35% 是 10pt 加粗公司全称实测下限不能缩；页码 15%；中列 50%（三列改版让宽）；
// 行1 标准题 9pt 小字（与 editor.css .lang-en 互指，改样式两边同步）
const EN_FONT_STACK = `'Times New Roman', Times, SimSun, '宋体', serif`;
const hfStyle = (lang) =>
    lang === 'en'
        ? HF_STYLE.replace(
              '</style>',
              `.hf { font-family: ${EN_FONT_STACK}; }\n.hf.header { font-size: 10pt; }\n.hf-title .hf-company { width: 35%; }\n.hf-title .hf-doc { width: 50%; font-size: 9pt; }\n.hf-title .hf-page { width: 15%; }\n</style>`
          )
        : HF_STYLE;

// 实测标定（2026-08，headless:true）：Chromium 页眉帧原点 = 纸顶 + 20px 固定内缩（margin.top 25/40/60mm 均不变），
// 页脚帧无此内缩（帧原点=下边距框顶，分页验证对齐到亚毫米）。页眉模板须反补 20px，否则整带下移、
// 且 pdf-lib 页码盖章（按测量坐标）与 Chromium 实际渲染的锚点文字上下错位 5.3mm
const HEADER_FRAME_INSET_PX = 20;

function hfTemplate(html, kind, layout, lang = 'zh') {
    // 页脚占位字段置空：只隐藏 {{...}} 本体，标签与灰线照常绘制（奇偶页脚同样显示）；
    // 行高 6mm 钉死 → 置空与签章回填带高相同。与编辑态 blankPendingHfFields 同源（stories.js），测量前置量同一 HTML
    if (kind === 'footer') html = blankPendingHfFields(html);
    const filled = (html || '')
        .replaceAll('{page}', '<span class="pg-anchor" style="visibility:hidden">88</span>')
        .replaceAll('{pages}', '<span class="pgt-anchor" style="visibility:hidden">88</span>')
        .replace(/\{\{sig:\w+\}\}/g, labelsOf(lang).pending) // 未签章兜底（中英文案同源 LABELS.pending）
        .replace(/\{\{\w+\}\}/g, ''); // 未传参占位兜底
    // 帧内纵向偏移（四段带模型）：页眉帧顶=纸顶+20px 内缩 → 下推上边距再反补内缩；页脚帧顶=下合成区顶 → 下推正文下padding，
    // 页脚带钉在帧底方向（带底距纸底=下边距）。margin 不计入 offsetHeight → 测量前置不受影响
    const frameOffset = kind === 'header' ? layout.headerFrameOffsetPx - HEADER_FRAME_INSET_PX : layout.footerFrameOffsetPx;
    return `${hfStyle(lang)}
    <div style="width:100%; box-sizing:border-box; margin-top:${frameOffset}px; padding:0 ${layout.marginsMm.right}mm 0 ${layout.marginsMm.left}mm;"><div class="hf ${kind}">${filled}</div></div>`;
    /* box-sizing:border-box 关键：模板帧宽=整页 CSS-px（A4 794），content-box 下 width:100%+padding
       会让容器比帧宽出 151px → 签名条/页码右部被帧裁剪（页码曾因此落在页外）；border-box 后
       内容区=版心 643px，与编辑态 sheet 完全一致，锚点测量也落在帧内 */
}

const PT_PER_PX = 0.75; // 标定：Chromium 页眉页脚模板 1 CSS-px = 0.75pt

/** 测量前置：隐藏页量页眉/页脚内容实测高（px）。版心宽只取决于左右边距（不撑高），与最终边距无关 */
async function measureHfHeights(browser, storyHtmls, layout0) {
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: layout0.paperPx.w, height: layout0.paperPx.h });
        await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
            ${storyHtmls.map((h, i) => `<div id="m${i}" style="width:${layout0.paperPx.w}px">${h}</div>`).join('')}
        </body></html>`);
        return await page.evaluate((n) => {
            const out = [];
            for (let i = 0; i < n; i++) out.push(document.querySelector(`#m${i} > div`)?.offsetHeight ?? 0);
            return out;
        }, storyHtmls.length);
    } finally {
        await page.close();
    }
}

/**
 * 在隐藏页里重建"模板帧"坐标系，量出页码锚点 rect（模板 px，页顶原点）。
 * 标定结论：模板视口 = 整页 CSS-px；页眉帧原点 = 纸顶 + 20px 固定内缩（模板侧已反补，见 HEADER_FRAME_INSET_PX）；
 * 页脚帧原点 = 下边距框顶；模板横向全页宽。
 * 边距必须是最终有效边距（撑高后）：页脚帧原点随之下移。
 */
async function measureAnchors(browser, headerHtml, footerHtml, layout) {
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: layout.paperPx.w, height: layout.paperPx.h });
        const frameTopPx = layout.paperPx.h - layout.marginsPx.bottom; // 页脚帧原点 = 下边距框顶
        // #hfh padding-top 模拟页眉帧的 20px 固定内缩（见 HEADER_FRAME_INSET_PX）——模板里已反补 -20px，
        // 测量页必须把这 20px 加回来，量到的锚点才是纸面真实落点（否则页码盖章比页眉文字高 5.3mm）
        await page.setContent(`<!DOCTYPE html><html><body style="margin:0">
            <div id="hfh" style="padding-top:${HEADER_FRAME_INSET_PX}px">${headerHtml}</div>
            <div id="hff" style="position:absolute; left:0; right:0; top:${frameTopPx}px">${footerHtml}</div>
        </body></html>`);
        return await page.evaluate(() => {
            const grab = (sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { left: r.left, top: r.top, width: r.width, height: r.height };
            };
            return {
                headerPage: grab('#hfh .pg-anchor'), footerPage: grab('#hff .pg-anchor'),
                headerTotal: grab('#hfh .pgt-anchor'), footerTotal: grab('#hff .pgt-anchor')
            };
        });
    } finally {
        await page.close();
    }
}

/** pdf-lib 在锚点中心盖章全局页码：按页码奇偶选锚点组（页码/总页数只含数字）。
 *  数字字体 = 嵌入的 Noto Serif 数字子集（assets/notoserif-digits.ttf，fontTools 裁剪 0-9，OFL 许可）——
 *  原来用标准 Helvetica，数字与旁边 Chromium 印的衬线汉字风格/字宽不一致 */
async function stampPageNumbers(sectionDoc, anchorsByParity, layout, firstPageNo, totalPages) {
    sectionDoc.registerFontkit(fontkit);
    const font = await sectionDoc.embedFont(digitFontBytes, { subset: true });
    const pageHpt = (layout.paperMm.h / 25.4) * 72;
    const HEADER_PT = 10.5; // 页眉字号（HF_STYLE/editor.css .hf.header 互指，2026-08-28 由 9 调大到 10.5）
    const FOOTER_PT = 9;
    const color = rgb(0.27, 0.27, 0.27); // 与 HF_STYLE 的 #444 一致
    const draw = (p, text, rect, size, bold) => {
        const tw = font.widthOfTextAtSize(text, size);
        const x = (rect.left + rect.width / 2) * PT_PER_PX - tw / 2;
        const y = pageHpt - ((rect.top + rect.height / 2) * PT_PER_PX + size * 0.35); // 视觉中心 → 基线
        p.drawText(text, { x, y, size, font, color });
        // pdf-lib 无合成粗体：微偏移二次叠描 = faux bold（页眉页码格用户要求加粗，Chromium 侧汉字是 faux-bold 轮廓，数字盖章须配套）
        if (bold) p.drawText(text, { x: x + size * 0.035, y, size, font, color });
    };
    sectionDoc.getPages().forEach((p, i) => {
        const pageNo = firstPageNo + i;
        const anchors = (pageNo % 2 === 0 && anchorsByParity.even) || anchorsByParity.odd;
        if (!anchors) return;
        const spots = [
            { rect: anchors.headerPage, kind: 'page', size: HEADER_PT, bold: true }, { rect: anchors.footerPage, kind: 'page', size: FOOTER_PT, bold: false },
            { rect: anchors.headerTotal, kind: 'total', size: HEADER_PT, bold: true }, { rect: anchors.footerTotal, kind: 'total', size: FOOTER_PT, bold: false }
        ].filter((s) => s.rect);
        for (const s of spots) draw(p, s.kind === 'page' ? String(pageNo) : String(totalPages), s.rect, s.size, s.bold);
    });
}

function buildHtmlDoc(section, layout, lang = 'zh', docBaseUrl = '', siteBaseUrl = '', docLinkPath = '/open_doc_link/?openFile=', siteLinkPath = '/?openFile=') {
    // 空段补 <br>：renderToHTMLString 对空段落输出 <p></p>，Chromium 里没行盒塌成 0 高——
    // 编辑态 PM 会给空块补 <br> 撑一行，打印侧不补则空行/空单元格比编辑态窄
    let bodyHtml = renderToHTMLString({ content: { type: 'doc', content: section.content }, extensions: EXTENSIONS })
        .replace(/<p([^>]*)><\/p>/g, '<p$1><br></p>');
    // 文档内部链接：doc JSON 存相对 href（不烘焙环境 base），此处展开成绝对 URI——
    // PDF link annotation 必须携带存活的外部绝对 URI（相对路径经 pdf-lib copyPages 后无法解析）。
    // docLinkPath（默认 /open_doc_link/?openFile=）：PDF 里点击由宿主端点跳转到目标文档（docBaseUrl=浏览器可达的服务根）；
    // siteLinkPath（默认 /?openFile=）：展开成前端深链（siteBaseUrl=站点根）。
    // 两者缺省都不替换：行为与未传参时逐字节一致
    if (docBaseUrl) bodyHtml = bodyHtml.replaceAll(`href="${docLinkPath}`, `href="${docBaseUrl.replace(/\/$/, '')}${docLinkPath}`);
    if (siteBaseUrl) bodyHtml = bodyHtml.replaceAll(`href="${siteLinkPath}`, `href="${siteBaseUrl.replace(/\/$/, '')}${siteLinkPath}`);
    // 英文文档（doc.lang='en'）：<html lang> 随语种 + 外层补 lang-en class——
    // sharedCss（editor.css）里 .lang-en .section-editor .ProseMirror 的 Times 优先栈直接生效，单一来源
    return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8" />
<style>
${sharedCss}
/* 打印态修正：去掉编辑器外观，仅保留文档样式 */
html, body { margin: 0; padding: 0; height: auto !important; } /* body 默认 8px margin 会让 380mm 正文右缘溢出打印区 8px → 多出一页窄条（A3 幻影页根因） */
body { background: #fff; }
.section-editor .ProseMirror { outline: none; min-height: 0 !important; }
/* 编辑态 html,body,#app{height:100%} + .ProseMirror{min-height:100%} 在打印视口（=整张纸）下
   会把正文撑到纸高 1122px > 打印区 979px → 每节多一页空白（上面的 !important 就是压它们） */
.ProseMirror { width: ${layout.contentWidthMm}mm; margin: 0; }
.doc-page-break::after { display: none; }
/* 注意：不要写 @page { margin: 0 }——文档 @page 规则会盖掉 page.pdf() 的 margin 选项，
   正文会铺满整张纸（页眉页脚直接压在正文上、左右贴边裁切）。页边距只由 pdf() 的 margin 选项给。 */
</style>
</head>
<body>
<div class="${lang === 'en' ? 'lang-en ' : ''}section-editor"><div class="ProseMirror">${bodyHtml}</div></div>
</body>
</html>`;
}

/** 渲染一节：引擎算几何 → （有偶数变体时两轮）渲染 → 交错合并 → 返回该节 PDF 文档与锚点 */
async function renderSection(browser, section, lang = 'zh', linkOpts = {}) {
    const spec = { size: section.pageSize, orientation: section.orientation, marginsMm: section.marginsMm, bodyPadMm: section.bodyPadMm };
    const odd = resolveStories(section, 1); // 奇数版=默认版
    const hasEven = !!(section.headerEven || section.footerEven);
    const even = hasEven ? resolveStories(section, 2) : null;
    // 页眉/页脚可缺省：带高=0（不占空间），模板给空白（Chromium 要求模板存在才能 displayHeaderFooter）
    const hasHeader = !!(section.header || section.headerEven);
    const hasFooter = !!(section.footer || section.footerEven);
    const BLANK = `${hfStyle(lang)}<div></div>`;
    const hfTpl = (html, kind, l, has) => (has ? hfTemplate(html, kind, l, lang) : BLANK);

    // 1. 测量前置：量各变体页眉/页脚实测高（取奇偶 max——两轮渲染共用同一边距，分页才能逐页一致）
    const layout0 = computePageLayout(spec);
    const htmls = [];
    if (hasHeader) htmls.push(hfTemplate(odd.header, 'header', layout0));
    if (hasFooter) htmls.push(hfTemplate(odd.footer, 'footer', layout0));
    if (even) {
        if (section.headerEven) htmls.push(hfTemplate(even.header, 'header', layout0));
        if (section.footerEven) htmls.push(hfTemplate(even.footer, 'footer', layout0));
    }
    const hs = await measureHfHeights(browser, htmls, layout0);
    let hi = 0;
    const hOdd = hasHeader ? hs[hi++] : 0;
    const fOdd = hasFooter ? hs[hi++] : 0;
    const hEven = even && section.headerEven ? hs[hi++] : 0;
    const fEven = even && section.footerEven ? hs[hi++] : 0;
    const layout = computePageLayout({
        ...spec,
        headerHeightPx: Math.max(hOdd, hEven),
        footerHeightPx: Math.max(fOdd, fEven)
    });

    // 2. 锚点测量（最终有效边距下的模板帧坐标；奇偶各一份）
    // has 必须按 even.header/even.footer 内容判（resolveStories 已把缺省变体回退到奇数版）——
    // 用 section.headerEven/footerEven 判会把"页脚有偶数变体、页眉没有"的节偶数页页眉锚点量成 null，
    // 偶数页页码整页漏盖（debug-hf-edit 步骤 6 抓到：第 2 页无盖章字体资源）
    const anchors = {
        odd: await measureAnchors(browser, hfTpl(odd.header, 'header', layout, hasHeader), hfTpl(odd.footer, 'footer', layout, hasFooter), layout),
        even: even
            ? await measureAnchors(browser, hfTpl(even.header, 'header', layout, !!even.header), hfTpl(even.footer, 'footer', layout, !!even.footer), layout)
            : null
    };

    // 3. 正文渲染：Pass1 奇数模板渲全部页；Pass2（有偶数变体且 ≥2 页）偶数模板只渲偶数页
    const margin = {
        top: `${layout.marginsMm.top}mm`, bottom: `${layout.marginsMm.bottom}mm`,
        left: `${layout.marginsMm.left}mm`, right: `${layout.marginsMm.right}mm`
    };
    const page = await browser.newPage();
    let oddDoc;
    try {
        await page.setContent(buildHtmlDoc(section, layout, lang, linkOpts.docBaseUrl, linkOpts.siteBaseUrl, linkOpts.docLinkPath, linkOpts.siteLinkPath), { waitUntil: 'networkidle0' });
        const pdfCommon = {
            width: `${layout.paperMm.w}mm`, height: `${layout.paperMm.h}mm`,
            margin, displayHeaderFooter: true, printBackground: true
        };
        oddDoc = await PDFDocument.load(await page.pdf({
            ...pdfCommon,
            headerTemplate: hfTpl(odd.header, 'header', layout, hasHeader),
            footerTemplate: hfTpl(odd.footer, 'footer', layout, hasFooter)
        }));
        const n = oddDoc.getPageCount();
        if (!even || n < 2) return { sectionDoc: oddDoc, anchors, layout };

        const evenRanges = Array.from({ length: Math.floor(n / 2) }, (_, i) => (i + 1) * 2).join(',');
        const evenDoc = await PDFDocument.load(await page.pdf({
            ...pdfCommon,
            pageRanges: evenRanges,
            headerTemplate: hfTpl(even.header, 'header', layout, hasHeader),
            footerTemplate: hfTpl(even.footer, 'footer', layout, hasFooter)
        }));
        // 交错合并：奇数页取 Pass1、偶数页取 Pass2（evenDoc 第 k 页 = 全文第 2k 页）
        const sectionDoc = await PDFDocument.create();
        for (let i = 0; i < n; i++) {
            const src = (i + 1) % 2 === 1 ? { doc: oddDoc, idx: i } : { doc: evenDoc, idx: Math.floor(i / 2) };
            const [p] = await sectionDoc.copyPages(src.doc, [src.idx]);
            sectionDoc.addPage(p);
        }
        return { sectionDoc, anchors, layout };
    } finally {
        await page.close();
    }
}

/**
 * 渲染整份文档：sections → 定版 PDF。
 * @param {Array} sections 各节 Tiptap JSON（含 pageSize/orientation/marginsMm/header/footer/…）
 * @param {{ lang?: string, docBaseUrl?: string, siteBaseUrl?: string, docLinkPath?: string, siteLinkPath?: string }} [opts]
 *   lang='en' 时正文/页眉页脚 Times 优先字体栈 + <html lang="en">（宿主传 doc.lang，缺省 zh）；
 *   docBaseUrl=浏览器可达的文档服务根：把正文相对 href="<docLinkPath>…"（默认 /open_doc_link/?openFile=）
 *   展开成绝对 URI——PDF 里点击由宿主端点跳转到目标文档（新 tab 直开）；
 *   siteBaseUrl=站点根：站点深链 href="<siteLinkPath>…"（默认 /?openFile=）展开成绝对前端链接。
 *   两者缺省都不替换，相对 href 原样保留
 * @returns {Promise<{ bytes: Buffer, pageCounts: number[] }>} bytes=合并后 PDF；pageCounts=各节页数
 */
export async function renderDocument(sections, opts = {}) {
    if (!Array.isArray(sections) || sections.length === 0) {
        throw new Error('sections required');
    }
    const lang = opts.lang === 'en' ? 'en' : 'zh';
    const linkOpts = {
        docBaseUrl: opts.docBaseUrl || '',
        siteBaseUrl: opts.siteBaseUrl || '',
        docLinkPath: opts.docLinkPath || undefined,
        siteLinkPath: opts.siteLinkPath || undefined
    };
    let browser;
    try {
        // 容器内以 root 运行 Chromium 必须关闭沙箱（crbug.com/638180），否则报
        // "Running as root without --no-sandbox is not supported"；
        // disable-dev-shm-usage 防止容器 /dev/shm 过小时渲染进程崩溃
        const puppeteer = await loadPuppeteer();
        // PUPPETEER_EXECUTABLE_PATH：用系统 Chromium（如 Docker 镜像 apt 装的 chromium，
        // 配合 PUPPETEER_SKIP_DOWNLOAD=1 不下载自带浏览器）；缺省用 puppeteer 自带
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
        browser = await puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
        const merged = await PDFDocument.create();

        // 第一遍：分节渲染（各节纸张/页眉页脚/有效边距不同，逐节测量 + 渲染）
        const rendered = [];
        for (const section of sections) {
            rendered.push(await renderSection(browser, section, lang, linkOpts));
        }

        // 第二遍：全局页码盖章（节偏移 = 前序各节页数前缀和；总页数 = 全部节页数之和）后合并
        const sectionPageCounts = rendered.map((r) => r.sectionDoc.getPageCount());
        const totalPages = sectionPageCounts.reduce((s, n) => s + n, 0);
        let firstPageNo = 1;
        for (let i = 0; i < rendered.length; i++) {
            const { sectionDoc, anchors, layout } = rendered[i];
            await stampPageNumbers(sectionDoc, anchors, layout, firstPageNo, totalPages);
            firstPageNo += sectionPageCounts[i];
            const pages = await merged.copyPages(sectionDoc, sectionDoc.getPageIndices());
            pages.forEach((p) => merged.addPage(p));
        }

        const mergedBytes = await merged.save();
        return { bytes: Buffer.from(mergedBytes), pageCounts: sectionPageCounts };
    } finally {
        await browser?.close();
    }
}
