import { TableCell, TableHeader } from '@tiptap/extension-table';

/**
 * 给表格单元格/表头加 backgroundColor 属性（表格浮动菜单的「背景色」用）。
 * 以 inline style 输出 → 服务端静态渲染自动携带，PDF 一致。
 */
const backgroundColorAttr = {
    backgroundColor: {
        default: null,
        parseHTML: (el) => el.style.backgroundColor || null,
        renderHTML: (attrs) => (attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {})
    }
};

export const TableCellBg = TableCell.extend({
    addAttributes() {
        return { ...this.parent?.(), ...backgroundColorAttr };
    }
});

export const TableHeaderBg = TableHeader.extend({
    addAttributes() {
        return { ...this.parent?.(), ...backgroundColorAttr };
    }
});
