/** 英文模板冒烟：中英两份物理模板（同一 LABELS 双语源生成）
 *  前置：npm run render-server（:8200）已启动
 *  ① 生成 tiptap-template-en.json / tiptap-template-blank-en.json（lang:'en' 落文档根）
 *  ② 页脚单行探针：全拼签名标签（Prepared/Checked/Audited/Approved/Date）在 A4 版心 180mm 不换行——
 *     换行会撑高页脚带、奇偶灰线错位；
 *     样式块复刻 render.js HF_STYLE + editor.css 的页脚相关规则（探针独立文档不继承 sharedCss，须内联）
 *  ③ fillParams + 签章 → /render（lang:'en'，Times 优先字体栈）→ smoke-en.pdf
 */
import { writeFile, mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { buildTemplateSections, buildBlankSections, fillParams, applySignatures, stories } from '../src/editor/templates/standardTemplate.js';

const out = new URL('./out/', import.meta.url);
await mkdir(out, { recursive: true });

// ① 英文模板 JSON（{{占位}} 保留；模板源码改动后须再生）
const raw = buildTemplateSections('en');
await writeFile(new URL('./tiptap-template-en.json', out), JSON.stringify({ version: 1, lang: 'en', sections: raw }, null, 2));
console.log('template-en JSON saved, sections =', raw.length);
const rawBlank = buildBlankSections('en');
await writeFile(new URL('./tiptap-template-blank-en.json', out), JSON.stringify({ version: 1, lang: 'en', sections: rawBlank }, null, 2));
console.log('template-blank-en JSON saved');

// ② 页脚单行探针：.foot-line 行高 6mm≈22.7px + padding-top 1.5mm + border ≈ 29.3px；换行 ≈ 52px → <40px 即单行；
//    页眉探针（3列×2行，章节号/名称进页眉中列第二行，QR 并入版本格 7mm，zh 页眉 11pt）：
//    ① 公司全称在公司格（nowrap）不溢出；② 两位数页码"第88页 共88页"/"Page 88 of 88"
//    在页码格（nowrap）不溢出——scrollWidth ≤ clientWidth；③ doc/chap 两格典型长名单行（行高 ≈8.5mm 不撑高）
const PROBE_CSS = `
html, body { margin: 0; padding: 0; }
*, *::before, *::after { box-sizing: border-box; } /* render.js HF_STYLE 带全局 border-box（编辑态对齐），探针复刻须同步 */
.hf { width: 100%; font-size: 9pt; color: #444; font-family: SimSun, '宋体', serif; }
.hf p { margin: 0; }
.hf-c { text-align: center; }
.hf.header { padding-top: 3mm; padding-bottom: 2mm; font-size: 11pt; }
.hf-title { width: 100%; border-collapse: collapse; table-layout: fixed; color: #000; }
.hf-title td { border: 1px solid #999; padding: 1pt 4pt; height: 8.5mm; vertical-align: middle; overflow-wrap: anywhere; }
.hf-title .hf-logo { display: inline-block; width: 4.5mm; height: 4.5mm; vertical-align: -0.8mm; margin-right: 1.2mm; }
.hf-title .hf-company { width: 29%; font-weight: 700; white-space: nowrap; }
.hf-title .hf-doc { width: 52%; font-weight: 700; }
.hf-title td.hf-doc { border-bottom: none; }
.hf-title td.hf-chap { border-top: none; }
.hf-title .hf-chap { font-weight: 700; }
.hf-title .hf-page { width: 19%; font-weight: 700; white-space: nowrap; }
.hf-title .hf-qr { display: inline-block; width: 7mm; height: 7mm; vertical-align: middle; }
.hf.footer { padding-top: 2mm; padding-bottom: 3mm; }
.foot-line { border-top: 1px solid #999; padding-top: 1.5mm; line-height: 6mm; }
.sig-img { display: inline-block; height: 5.5mm; vertical-align: -1.4mm; }
.sig-slot { display: inline-block; width: 18mm; }
.date-slot { display: inline-block; width: 18mm; }
.email-slot { display: inline-block; width: 48mm; }
.lang-en .hf { font-family: 'Times New Roman', Times, SimSun, '宋体', serif; }
.lang-en .hf.header { font-size: 10pt; }
.lang-en .hf .hf-title .hf-company { width: 35%; }
.lang-en .hf .hf-title .hf-doc { width: 50%; font-size: 9pt; }
.lang-en .hf .hf-title .hf-page { width: 15%; }
`;
const CONTENT_WIDTH_PX = Math.round((180 / 25.4) * 96); // A4 版心：210 - 15×2 mm
const probe = await puppeteer.launch({ headless: true });
try {
    // 页眉填入典型长值（双语各自典型长名），断言最坏情况下不换行/不溢出
    const fillHead = (lang) =>
        stories
            .headerOdd(lang)
            .replaceAll('{page}', '88')
            .replaceAll('{pages}', '88')
            .replaceAll('{{verNo}}', 'V001')
            .replaceAll('{{stdNo}}', 'DOC-2026-0001')
            .replaceAll('{{stdName}}', lang === 'en' ? 'Example Process Standard Doc' : '工艺标准文件')
            .replaceAll('{{chapNo}}', '03')
            .replaceAll('{{chapName}}', lang === 'en' ? 'Example Part Process' : '示例零件加工工艺');
    const page = await probe.newPage();
    await page.setViewport({ width: 794, height: 1122 });
    await page.setContent(`<!DOCTYPE html><html><head><style>${PROBE_CSS}</style></head><body style="margin:0">
        <div id="zh-odd" class="hf footer" style="width:${CONTENT_WIDTH_PX}px">${stories.footerOdd('zh')}</div>
        <div id="en-odd" class="lang-en"><div class="hf footer" style="width:${CONTENT_WIDTH_PX}px">${stories.footerOdd('en')}</div></div>
        <div id="en-even" class="lang-en"><div class="hf footer" style="width:${CONTENT_WIDTH_PX}px">${stories.footerEven('en')}</div></div>
        <div id="en-head" class="lang-en"><div class="hf header" style="width:${CONTENT_WIDTH_PX}px">${fillHead('en')}</div></div>
        <div id="zh-head"><div class="hf header" style="width:${CONTENT_WIDTH_PX}px">${fillHead('zh')}</div></div>
    </body></html>`);
    const heights = await page.evaluate(() => {
        const grab = (id) => document.querySelector(`#${id} .foot-line`)?.offsetHeight ?? 0;
        return { zhOdd: grab('zh-odd'), enOdd: grab('en-odd'), enEven: grab('en-even') };
    });
    console.log('页脚 foot-line 实测高(px):', heights);
    const bad = Object.entries(heights).filter(([, h]) => h >= 40);
    if (bad.length) {
        console.error('页脚签名单行验证失败（疑似换行撑高）:', bad);
        process.exit(1);
    }
    console.log('页脚单行验证通过（全拼标签不换行，奇偶带高一致）');
    const overflow = await page.evaluate(() => {
        const grab = (id, sel) => {
            const td = document.querySelector(`#${id} ${sel}`);
            return td ? { scroll: td.scrollWidth, client: td.clientWidth } : null;
        };
        return {
            companyEn: grab('en-head', '.hf-company'), companyZh: grab('zh-head', '.hf-company'),
            pageEn: grab('en-head', '.hf-page'), pageZh: grab('zh-head', '.hf-page'),
            docEn: grab('en-head', '.hf-doc'), docZh: grab('zh-head', '.hf-doc'),
            chapEn: grab('en-head', '.hf-chap'), chapZh: grab('zh-head', '.hf-chap')
        };
    });
    console.log('页眉格 内容宽/格宽(px):', overflow);
    if (!overflow.chapEn || !overflow.chapZh) {
        console.error('页眉缺章节行（.hf-chap 格不存在）');
        process.exit(1);
    }
    for (const [k, v] of Object.entries(overflow)) {
        if (v && v.scroll > v.client) {
            console.error(`页眉格溢出（${k}）:`, v);
            process.exit(1);
        }
    }
    // doc/chap 两格单行断言：典型长名折行会撑高所在行（自然行高 ≈8.5mm≈32px，折行 ≈54px）
    const rowHeights = await page.evaluate(() => {
        const grab = (id) => [...document.querySelectorAll(`#${id} .hf-title tr`)].map((tr) => tr.offsetHeight);
        return { en: grab('en-head'), zh: grab('zh-head') };
    });
    console.log('页眉行高(px):', rowHeights);
    for (const [k, rows] of Object.entries(rowHeights)) {
        if (rows.length !== 2 || rows.some((h) => h >= 40)) {
            console.error(`页眉行被撑高（${k}，疑似 doc/chap 折行）:`, rows);
            process.exit(1);
        }
    }
    // 编辑态=渲染态几何不变量（box-sizing 修复）：border-box 下格宽须等于 版心×百分比（±2px 取整/边框坍缩），
    // 否则临界长度标题编辑态一行、导出折两行。版心 680px：zh 29/52/19、en 35/50/15
    const parity = { companyEn: 237, docEn: 339, pageEn: 101, companyZh: 195, docZh: 352, pageZh: 127 };
    for (const [k, want] of Object.entries(parity)) {
        if (Math.abs((overflow[k]?.client ?? 0) - want) > 2) {
            console.error(`页眉格宽与编辑态不一致（${k}）: 实测 ${overflow[k]?.client} 期望 ${want}±2`);
            process.exit(1);
        }
    }
    console.log('页眉验证通过（公司全称不溢出、两位数页码平铺不溢出、章节行存在且 doc/chap 单行、格宽与编辑态一致）');
} finally {
    await probe.close();
}

// ③ EN 渲染验证（lang:'en' → Times 优先字体栈 + <html lang="en">）
const params = {
    stdName: 'Example Process Standard Doc',
    stdNo: 'DOC-2026-0001',
    projectName: 'Demo Project',
    lineNo: 'L3',
    partName: 'Example Part',
    preparedBy: 'zhangsan',
    preparedByEmail: 'zhangsan@example.com'
};
const sections = applySignatures(fillParams(buildTemplateSections('en'), params), {
    submitter: { signedBy: 'zhangsan', signedAt: '2026-08-20' },
    checker: { signedBy: 'lisi', signedAt: '2026-08-21' },
    auditor: { signedBy: 'wangwu', signedAt: '2026-08-22' },
    approver: { signedBy: 'zhaoliu', signedAt: '2026-08-24' }
}, { lang: 'en' });

const resp = await fetch('http://localhost:8200/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections, lang: 'en' })
});
if (!resp.ok) {
    console.error('render failed:', resp.status, await resp.text());
    process.exit(1);
}
console.log('page counts per section:', resp.headers.get('X-Section-Page-Counts'));
const buf = Buffer.from(await resp.arrayBuffer());
await writeFile(new URL('./smoke-en.pdf', out), buf);
console.log('saved smoke-en.pdf, bytes =', buf.length);
