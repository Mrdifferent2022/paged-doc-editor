import { Node, mergeAttributes } from '@tiptap/core';

/**
 * pageBreak —— 手动分页符
 * 编辑态：渲染为一条"分页"指示线，并配合 CSS break-after: page 影响打印。
 */
export const PageBreak = Node.create({
    name: 'pageBreak',
    group: 'block',
    atom: true,

    parseHTML() {
        return [{ tag: 'div[data-page-break]' }];
    },

    renderHTML() {
        return ['div', mergeAttributes({ 'data-page-break': '', class: 'doc-page-break' })];
    },

    addCommands() {
        return {
            insertPageBreak:
                () =>
                ({ chain }) =>
                    chain().insertContent({ type: 'pageBreak' }).run()
        };
    }
});
