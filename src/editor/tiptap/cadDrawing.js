import { mergeAttributes, Node } from '@tiptap/core';

/**
 * CAD 图纸节点（块级 atom，2026-09-23）：
 * - 图纸源内嵌 doc JSON（单事实源架构不动：版本/审批/复制/渲染零新端点）：
 *   data=图纸内容（dxf 文本或 base64）、enc='utf8'|'base64'、fmt='dxf'、name=原始文件名
 * - preview=白底黑白 PNG dataURL（上传转换/弹窗编辑关闭时由 cadSnapshot.js 快照生成），
 *   定版渲染只看 preview——render-server 不跑 mlightcad，输出与图片同一打印路径
 * - DOM 与 DocImage 同构（width% 纸宽 / align margin / crop 原图坐标窗口），
 *   ImageFloatingMenu 的对齐/缩放/裁剪/删除直接通吃
 * - 无 preview（空白图纸未编辑）→ 虚线占位框；双击（编辑/只读）开 mlightcad 弹窗——
 *   双击拦截在 SectionedEditor <main> 的事件委托（[data-cad-drawing]），本节点无需 NodeView
 *
 * 全部自定义属性 rendered:false（坑 #27 同款：默认会把属性吐成 HTML 属性）。
 * parseHTML 只保 preview/width/align（crop 与图纸源 data 不进 HTML）——body 只走 JSON，
 * HTML 往返仅发生在粘贴/页眉页脚子编辑器，注释说明，不是丢数据的 bug。
 */

// 与 DocImage 完全同款的对齐 margin 算式（两态一致的前提是同一份逻辑）
const alignMargins = (align) =>
    align === 'center' ? 'margin-left:auto;margin-right:auto' : align === 'right' ? 'margin-left:auto' : 'margin-right:auto'; // left

// crop 窗口样式：background-image 装完整预览图，background-size/position 百分比把窗口对准裁剪区
// （background-image 百分比相对容器，zoom/打印无需像素换算）
const cropStyle = ({ width, align, crop, preview }) => {
    const bx = crop.natW > crop.w ? (crop.x / (crop.natW - crop.w)) * 100 : 0;
    const by = crop.natH > crop.h ? (crop.y / (crop.natH - crop.h)) * 100 : 0;
    return [
        `width:${width ?? 100}%`,
        `aspect-ratio:${crop.w}/${crop.h}`,
        `background-image:url("${preview}")`,
        'background-repeat:no-repeat',
        `background-size:${(crop.natW / crop.w) * 100}% ${(crop.natH / crop.h) * 100}%`,
        `background-position:${bx}% ${by}%`,
        'background-color:#fff', // 白底兜底（PNG 快照自带白底，这里是透明降级保护）
        alignMargins(align)
    ].join(';');
};

export const CadDrawing = Node.create({
    name: 'cadDrawing',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            data: { default: null, rendered: false }, // 图纸源内容（dxf 文本 | base64）
            enc: { default: 'utf8', rendered: false }, // data 编码：'utf8' | 'base64'（二进制 dxf）
            fmt: { default: 'dxf', rendered: false }, // 原始格式（恒为 dxf——仅支持 DXF；dxfOut 也只出 DXF）
            name: { default: '', rendered: false }, // 原始文件名（弹窗标题/提示用）
            preview: { default: null, rendered: false }, // 白底黑白 PNG dataURL（null=空白图纸未编辑）
            width: { default: 100, rendered: false }, // % 纸宽（HTML 解析走规则级 getAttrs，见下）
            align: { default: 'center', rendered: false },
            crop: { default: null, rendered: false } // { x, y, w, h, natW, natH } 预览图像素单位
        };
    },

    parseHTML() {
        return [
            {
                tag: '[data-cad-drawing]',
                // 规则级 getAttrs 会替代属性级 parseHTML（PM 行为）——width/align/preview 都在这里拿全。
                // 只保 preview/width/align：图纸源 data 与 crop 不序列进 HTML（体积），body 只走 JSON 不失真
                getAttrs: (el) => {
                    const s = el.style;
                    const w = /^(\d+(?:\.\d+)?)%$/.exec(s.width || '');
                    // preview：无裁剪=<img src>；裁剪=background-image:url("data:image/png;base64,...")（base64 无括号/引号，提取安全）
                    const bg = /url\("([^"]+)"\)/.exec(s.backgroundImage || '');
                    return {
                        preview: (el.tagName === 'IMG' ? el.getAttribute('src') : null) ?? bg?.[1] ?? el.querySelector('img')?.getAttribute('src') ?? null,
                        width: w ? parseFloat(w[1]) : 100,
                        align: s.marginLeft === 'auto' && s.marginRight === 'auto' ? 'center' : s.marginLeft === 'auto' ? 'right' : 'left'
                    };
                }
            }
        ];
    },

    renderHTML({ node }) {
        const { preview, width, align, crop, name } = node.attrs;
        if (!preview) {
            // 空白占位：虚线框 + 提示（定版渲染也输出此框——诚实表达"这里有一张未编辑的图纸"）
            return [
                'div',
                mergeAttributes({ 'data-cad-drawing': '', class: 'cad-node-empty' }, { style: alignMargins(align) }),
                `CAD 图纸${name ? `：${name}` : ''}（双击编辑）`
            ];
        }
        if (crop && crop.w > 0 && crop.h > 0 && crop.natW && crop.natH) {
            return ['div', mergeAttributes({ 'data-cad-drawing': '', class: 'cad-crop', role: 'img' }, { style: cropStyle(node.attrs) })];
        }
        const style = `display:block;max-width:100%;height:auto;background:#fff;width:${width ?? 100}%;${alignMargins(align)}`;
        return ['img', mergeAttributes({ 'data-cad-drawing': '', src: preview, alt: name || 'CAD 图纸', draggable: 'false' }, { style })];
    }
});
