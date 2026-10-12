import { renderToHTMLString } from '@tiptap/static-renderer';
import { buildExtensions } from '../src/editor/tiptap/index.js';
const html = renderToHTMLString({
    extensions: buildExtensions(),
    content: { type: 'doc', content: [
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', width: 50, align: 'right', crop: { x: 20, y: 10, w: 350, h: 275, natW: 400, natH: 300 } } },
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] }
    ] }
});
console.log(html);
if (!html.includes('background-size:114.28') || !html.includes('background-position:40%') || !html.includes('aspect-ratio:350/275')) { console.error('RENDER FAIL'); process.exit(1); }
if (html.includes('crop=') || html.includes('align=')) { console.error('ATTR LEAK'); process.exit(1); }
console.log('SERVER-RENDER-OK');
