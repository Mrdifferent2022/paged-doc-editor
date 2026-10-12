// 服务端静态渲染验证：DocTable 覆写 renderHTML 后 width 与 align margin 同时输出（getTableStyle 陷阱回归），align 不漏 HTML 属性
import { renderToHTMLString } from '@tiptap/static-renderer';
import { buildExtensions } from '../src/editor/tiptap/index.js';

const cell = (t, cw) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: cw }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const html = renderToHTMLString({
    extensions: buildExtensions(),
    content: { type: 'doc', content: [
        { type: 'table', attrs: { align: 'center' }, content: [
            { type: 'tableRow', content: [cell('a', [200]), cell('b', [200]), cell('c', [200])] },
            { type: 'tableRow', content: [cell('d', [200]), cell('e', [200]), cell('f', [200])] }
        ] },
        { type: 'table', content: [
            { type: 'tableRow', content: [cell('g', [100]), cell('h', [100])] }
        ] },
        { type: 'table', attrs: { align: 'right' }, content: [
            { type: 'tableRow', content: [cell('i', null), cell('j', null)] }
        ] }
    ] }
});
console.log(html);
// 居中定宽表：width:600px 与 margin auto 必须同时存在
if (!html.includes('width: 600px') || !html.includes('margin-left: auto') || !html.includes('margin-right: auto')) {
    console.error('RENDER FAIL: center align + width not both present');
    process.exit(1);
}
// 无 align 表：无 margin auto
const tables = html.split('<table');
if (tables[2].includes('margin-left: auto')) { console.error('RENDER FAIL: default table has margin auto'); process.exit(1); }
// 无 colwidth + right：min-width + 右对齐 margin
if (!tables[3].includes('min-width:') || !tables[3].includes('margin-left: auto') || tables[3].includes('margin-right: auto')) {
    console.error('RENDER FAIL: right align min-width table');
    process.exit(1);
}
// align 不漏成 HTML 属性（坑 #27）
if (html.includes('align=')) { console.error('ATTR LEAK'); process.exit(1); }
console.log('TABLE-RENDER-OK');
