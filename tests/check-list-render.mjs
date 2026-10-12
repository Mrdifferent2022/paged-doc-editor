// 服务端静态渲染验证：列表标记 class/style 与题注 class 输出正确，listType/caption 属性不泄漏成 HTML 属性
import { renderToHTMLString } from '@tiptap/static-renderer';
import { buildExtensions } from '../src/editor/tiptap/index.js';

const html = renderToHTMLString({
    extensions: buildExtensions(),
    content: { type: 'doc', content: [
        { type: 'bulletList', attrs: { listType: 'dash' }, content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] }
        ] },
        { type: 'bulletList', attrs: { listType: 'circle' }, content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] }
        ] },
        { type: 'orderedList', attrs: { listType: 'paren' }, content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一' }] }] }
        ] },
        { type: 'orderedList', attrs: { listType: 'lower-roman' }, content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二' }] }] }
        ] },
        { type: 'paragraph', attrs: { caption: true }, content: [{ type: 'text', text: '总体框图' }] }
    ] }
});
console.log(html);
const must = ['class="ul-dash"', 'list-style-type:circle', 'class="ol-paren"', 'list-style-type:lower-roman', 'class="doc-caption"'];
for (const m of must) {
    if (!html.includes(m)) { console.error('RENDER FAIL missing: ' + m); process.exit(1); }
}
if (html.includes('listType=') || html.includes('caption=')) { console.error('ATTR LEAK'); process.exit(1); }
console.log('LIST-CAPTION-RENDER-OK');
