import { mergeAttributes } from '@tiptap/core';
import { Paragraph } from '@tiptap/extension-paragraph';
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';

/**
 * 列表标记样式 + 题注段落（替换 StarterKit 内置的 paragraph/bulletList/orderedList）：
 * - BulletList.listType：disc(默认，无输出) / circle / square（原生 list-style-type）/ dash（class 自定义 ::before）
 * - OrderedList.listType：decimal(默认) / lower-roman / upper-roman / lower-alpha（原生）
 *   / paren(1）2）) / pparen(（1）) / angle(<1>)（class + CSS counter，编辑态与打印态共用 editor.css）
 * - Paragraph.caption：题注段落（图片下方的"图 N 说明"），class=doc-caption，
 *   编号由 CSS counter(figcap) 自动生成——插删题注自动重排，打印态一致（按节各自编号）
 * 自定义属性一律 rendered:false（坑 #27：默认会漏成同名 HTML 属性），输出只走 renderHTML。
 */

// —— 题注段落（图 N 自动编号） ——
export const DocParagraph = Paragraph.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            caption: {
                default: false,
                rendered: false,
                parseHTML: (el) => el.classList.contains('doc-caption')
            }
        };
    },
    renderHTML({ node, HTMLAttributes }) {
        return ['p', mergeAttributes(HTMLAttributes, node.attrs.caption ? { class: 'doc-caption' } : {}), 0];
    },
    // 题注逃逸（2026-09-11 用户：题注里回车永远是题注，回不到正文；同日二轮：空题注原地转换会把
    // "图 N"前缀搞没，用户要的是题注保留+回车换行到下方正文）——splitBlock 必继承节点属性
    // （caption:true 无限传播），这里在段末拦截：无论空/非空，一律在下方插普通段落并移入光标，
    // 题注段落本身不动（insertCaption 同款 insertContentAt 惯用法）。
    // 段中回车不拦截（默认 split 两边仍题注 = 多行题注保留）；非题注/选区非空一律放行。
    addKeyboardShortcuts() {
        return {
            ...this.parent?.(),
            Enter: () => {
                const { state } = this.editor;
                const { $from, empty } = state.selection;
                if (!empty) return false;
                const para = $from.parent;
                if (para.type.name !== 'paragraph' || !para.attrs.caption) return false;
                if ($from.parentOffset !== para.content.size) return false; // 段中回车：保留多行题注
                const after = $from.after();
                return this.editor.chain().insertContentAt(after, { type: 'paragraph', attrs: { caption: false } }).setTextSelection(after + 1).run();
            }
        };
    }
});

// —— 无序列表标记：● 实心圆 / ○ 空心圆 / ■ 方块 / – 短横 ——
const BULLET_NATIVE = ['circle', 'square']; // disc 为默认，无需输出
export const BULLET_TYPES = [
    { value: 'disc', label: '● 实心圆', glyph: '●' },
    { value: 'circle', label: '○ 空心圆', glyph: '○' },
    { value: 'square', label: '■ 方块', glyph: '■' },
    { value: 'dash', label: '– 短横线', glyph: '–' }
];
export const DocBulletList = BulletList.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            listType: {
                default: 'disc',
                rendered: false,
                parseHTML: (el) => (el.classList.contains('ul-dash') ? 'dash' : el.style.listStyleType || 'disc')
            }
        };
    },
    renderHTML({ node, HTMLAttributes }) {
        const t = node.attrs.listType || 'disc';
        const extra = BULLET_NATIVE.includes(t) ? { style: `list-style-type:${t}` } : t === 'dash' ? { class: 'ul-dash' } : {};
        return ['ul', mergeAttributes(HTMLAttributes, extra), 0];
    }
});

// —— 有序列表标记：1. / i. / I. / a.（原生）；1）/（1）/ <1>（CSS counter） ——
const ORDERED_NATIVE = ['lower-roman', 'upper-roman', 'lower-alpha']; // decimal 为默认，无需输出
export const ORDERED_TYPES = [
    { value: 'decimal', label: '1. 2. 3.', glyph: '1.' },
    { value: 'lower-roman', label: 'i. ii. iii.', glyph: 'i.' },
    { value: 'upper-roman', label: 'I. II. III.', glyph: 'I.' },
    { value: 'lower-alpha', label: 'a. b. c.', glyph: 'a.' },
    { value: 'paren', label: '1）2）3）', glyph: '1）' },
    { value: 'pparen', label: '（1）（2）（3）', glyph: '（1）' },
    { value: 'angle', label: '<1> <2> <3>', glyph: '<1>' }
];
export const DocOrderedList = OrderedList.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            listType: {
                default: 'decimal',
                rendered: false,
                parseHTML: (el) => {
                    const cls = ['paren', 'pparen', 'angle'].find((k) => el.classList.contains(`ol-${k}`));
                    return cls || el.style.listStyleType || 'decimal';
                }
            }
        };
    },
    renderHTML({ node, HTMLAttributes }) {
        const t = node.attrs.listType || 'decimal';
        const extra = ORDERED_NATIVE.includes(t)
            ? { style: `list-style-type:${t}` }
            : t !== 'decimal'
              ? { class: `ol-${t}` }
              : {};
        return ['ol', mergeAttributes(HTMLAttributes, extra), 0];
    }
});
