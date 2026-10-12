import { mergeAttributes } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Table, TableView, createColGroup } from '@tiptap/extension-table';

/**
 * 表格对齐（左/中/右）——窄于版心的定宽表用 margin auto 表达对齐，与图片 align 同模型。
 *
 * 两个坑（详见 README 坑 #30）：
 * 1. tiptap Table 的 renderHTML 里 getTableStyle() 一旦 HTMLAttributes 有 userStyles 就丢弃 width/minWidth，
 *    所以 align 不能用属性级 style 输出（会把表格 px 定宽冲掉，margin auto 失效）——必须整体覆写 renderHTML，
 *    用 createColGroup 拿回 width/minWidth 与 margin 一起拼 style。align 属性自身 renderHTML 返回 {}（防坑 #27 漏属性）。
 * 2. 编辑态表格 DOM 不走 renderHTML——columnResizing 把 View 注册为 node view，TableView 自建 table DOM。
 *    所以编辑态对齐必须子类化 TableView 写 margin，经 Table.configure({ View }) 注入；
 *    服务端静态渲染走 renderHTML，两条路径各自覆盖。
 */

const ALIGN_STYLE = {
    left: 'margin-left: 0; margin-right: auto',
    center: 'margin-left: auto; margin-right: auto',
    right: 'margin-left: auto; margin-right: 0'
};

// 编辑态：TableView 自建 table DOM，updateColumns 只碰 style.width/minWidth，margin 由这里维护
export class AlignTableView extends TableView {
    constructor(node, cellMinWidth, view, HTMLAttributes) {
        super(node, cellMinWidth, view, HTMLAttributes);
        this.applyAlign(node);
    }

    applyAlign(node) {
        const a = node.attrs.align;
        this.table.style.marginLeft = a === 'center' || a === 'right' ? 'auto' : '';
        this.table.style.marginRight = a === 'center' || a === 'left' ? 'auto' : '';
        // '' 回落到 stylesheet 的 margin: 8pt 0（左右=0），即默认左贴
    }

    update(node) {
        if (!super.update(node)) return false;
        this.applyAlign(node);
        return true;
    }
}

export const DocTable = Table.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            align: {
                default: null, // null = 默认（左贴 / 100% 宽）
                parseHTML: (el) => {
                    const ml = el.style.marginLeft;
                    const mr = el.style.marginRight;
                    if (ml === 'auto' && mr === 'auto') return 'center';
                    if (ml === 'auto') return 'right';
                    if (mr === 'auto') return 'left';
                    return null;
                },
                renderHTML: () => ({}) // 不直出（防漏 align= HTML 属性）；style 由节点 renderHTML 统一拼
            }
        };
    },

    // 静态渲染（服务端/PDF）：整体覆写——width 与 margin 必须一起进 style（getTableStyle 陷阱，见文件头）
    renderHTML({ node, HTMLAttributes }) {
        const { colgroup, tableWidth, tableMinWidth } = createColGroup(node, this.options.cellMinWidth);
        const styles = [tableWidth ? `width: ${tableWidth}` : `min-width: ${tableMinWidth}`];
        if (node.attrs.align && ALIGN_STYLE[node.attrs.align]) styles.push(ALIGN_STYLE[node.attrs.align]);
        const table = ['table', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { style: styles.join('; ') }), colgroup, ['tbody', 0]];
        return this.options.renderWrapper ? ['div', { class: 'tableWrapper' }, table] : table;
    }
});

/**
 * 编辑态表格 DOM 同步（class + align margin）。
 * 坑 #43 补：tiptap 当前版本 Table.addNodeView 在 resizable&&editable 时直接 return null——
 * AlignTableView 只在只读编辑器生效；编辑态表格 DOM 由 prosemirror-tables columnResizing 的
 * TableView 自建，它只维护 width/minWidth，**不套 HTMLAttributes**——模板页眉 <table class="hf-title">
 * 进子编辑器后 class 丢失，td 行高/边框/字号全塌（预览 65px vs 编辑 170px，2026-08-28 发现）。
 * 该 TableView.update 只碰 col/width，从不写 class/margin，所以我们在每次视图更新后把
 * node.attrs.class 与 align margin 补写到 table DOM 上（不会被后续 update 抹掉）。
 */
const syncTableDom = (view) => {
    view.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'table') return true;
        const dom = view.nodeDOM(pos);
        const table = dom?.tagName === 'TABLE' ? dom : dom?.querySelector?.('table');
        if (!table) return true;
        const cls = node.attrs.class;
        if (cls) {
            if (table.getAttribute('class') !== cls) table.setAttribute('class', cls);
        } else if (table.hasAttribute('class')) {
            table.removeAttribute('class');
        }
        const a = node.attrs.align;
        const ml = a === 'center' || a === 'right' ? 'auto' : '';
        const mr = a === 'center' || a === 'left' ? 'auto' : '';
        if (table.style.marginLeft !== ml) table.style.marginLeft = ml;
        if (table.style.marginRight !== mr) table.style.marginRight = mr;
        return true;
    });
};

export const TableDomSync = Extension.create({
    name: 'tableDomSync',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                view: (view) => {
                    syncTableDom(view); // 初始挂载后补一次
                    return { update: (v) => syncTableDom(v) };
                }
            })
        ];
    }
});
