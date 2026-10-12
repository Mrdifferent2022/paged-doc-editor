import { mergeAttributes, Node } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';

/**
 * 文档图片节点（在原版 Image 上加可编辑属性）：
 * - width：百分比数字（25/50/75/100…，相对纸张内容宽）；null = 原始尺寸（CSS 仍 max-width:100% 兜底）
 * - align：left / center / right（块级图片用 margin auto 实现，不依赖 textAlign）
 * - crop：{ x, y, w, h, natW, natH } | null —— 裁剪窗口（原图像素坐标）。**不破坏 src**，
 *   渲染成 background 窗口 div：原图完整保留在 JSON 里，二次裁剪可看到全图再调整（Word 同款）。
 *   显示几何全部走百分比（background-size/position 的 % 相对容器），zoom/打印均无需像素换算：
 *     显示宽 = width% 纸宽；aspect-ratio = w/h；
 *     background-size = natW/w × natH/h（%）——把完整原图放大到"窗口恰为裁剪区"；
 *     background-position = x/(natW−w) : y/(natH−h)（%）——标准对齐公式，移动窗口到裁剪起点。
 *
 * 三个自定义属性必须 rendered:false —— tiptap 默认把节点属性原样吐成同名 HTML 属性，
 * <img align="right"> 是废弃属性、浏览器映射成 float:right 会让图片脱离文档流（坑 #27）。
 * renderHTML 输出 inline style → 服务端静态渲染自动携带，编辑态与 PDF 一致（需 printBackground）。
 */
export const DocImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: null,
                rendered: false,
                parseHTML: (el) => {
                    const w = el.style.width || el.getAttribute('width');
                    const m = /^(\d+(?:\.\d+)?)%$/.exec(w || '');
                    return m ? parseFloat(m[1]) : null;
                }
            },
            align: {
                default: 'center',
                rendered: false,
                parseHTML: (el) => {
                    const s = el.style;
                    if (s.marginLeft === 'auto' && s.marginRight === 'auto') return 'center';
                    if (s.marginLeft === 'auto') return 'right';
                    return 'left';
                }
            },
            crop: { default: null, rendered: false } // { x, y, w, h, natW, natH } 原图像素坐标
        };
    },
    renderHTML({ node, HTMLAttributes }) {
        const { width, align, crop } = node.attrs;
        const margins =
            align === 'center'
                ? 'margin-left:auto;margin-right:auto'
                : align === 'right'
                  ? 'margin-left:auto'
                  : 'margin-right:auto'; // left
        if (crop && crop.w > 0 && crop.h > 0 && crop.natW && crop.natH) {
            const bx = crop.natW > crop.w ? (crop.x / (crop.natW - crop.w)) * 100 : 0;
            const by = crop.natH > crop.h ? (crop.y / (crop.natH - crop.h)) * 100 : 0;
            const style = [
                `width:${width ?? 100}%`,
                `aspect-ratio:${crop.w}/${crop.h}`,
                `background-image:url("${HTMLAttributes.src}")`,
                'background-repeat:no-repeat',
                `background-size:${(crop.natW / crop.w) * 100}% ${(crop.natH / crop.h) * 100}%`,
                `background-position:${bx}% ${by}%`,
                margins
            ].join(';');
            return ['div', mergeAttributes({ class: 'img-cropped', role: 'img' }, { style })];
        }
        const style = `display:block;max-width:100%;height:auto;${width ? `width:${width}%;` : ''}${margins}`;
        return ['img', mergeAttributes(HTMLAttributes, { style })];
    }
});

/**
 * 行内图片节点（inline atom）——页眉页脚里的小图标（公司 logo 等"文字流中的图"）。
 * DocImage 是块级（inline:false）：放 td 文本流里会断行、且 PM 对不认识的 <svg> 直接剥掉
 * （实测：页眉 logo 用内联 <svg> 写，进子编辑器 round-trip 后 logo 消失）。
 * 行内图改走 <img data-inline>：atom 保真 round-trip，样式全挂 class（.hf-logo 等），
 * 不进正文图片的 align/crop/width 体系（NodeView 菜单不识别本节点）。
 */
export const InlineImage = Node.create({
    name: 'inlineImage',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
        return {
            src: { default: null },
            alt: { default: '' },
            class: { default: null }
        };
    },

    parseHTML() {
        return [{ tag: 'img[data-inline]' }];
    },

    renderHTML({ node }) {
        return ['img', mergeAttributes({ 'data-inline': 'true' }, { src: node.attrs.src, alt: node.attrs.alt, class: node.attrs.class })];
    }
});
