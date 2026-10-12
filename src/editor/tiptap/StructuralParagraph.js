import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * 结构补段（Word 同款：表格/图片这类非文本块后面必须永远有一个可落竖向光标的段落位）：
 * 表格/图片紧跟的不是文本块（分页符、另一个表格、文档末尾）时，点击其下方只能落 GapCursor
 * ——横向光标，用户 2026-09-11 投诉"第一页表格下面光标是横的，摁回车才变竖的；竖向才正常"。
 * appendTransaction 自动在中间补一个空段落 → 点击即竖向光标，无需先回车。
 *
 * 注意：
 * - 只挂正文编辑器（SectionEditor）；页眉页脚子编辑器里 hf-title/foot-contacts 表就是末尾节点，
 *   补段会把页眉带撑高——HeaderFooterEditor 用 buildExtensions({ structuralParagraph: false }) 关闭。
 * - 补的段落是真实文档内容（随 JSON 保存/打印，Word 同样如此）；
 *   用户删它会在同事务被补回（表格紧邻分页符期间该段不可删，与 Word 一致）。
 * - 服务端渲染（render.js generateHTML）不跑插件事务，零影响。
 * - appendTransaction 只在 docChanged 事务后触发，纯加载不编辑时扫描从未执行
 *   （2026-09-11 二轮用户实测：刷新后不做编辑直接点表格下方仍是横向光标）——
 *   故 onCreate 挂载即补一次，且 addToHistory:false 不进 undo 栈（否则挂载即 Ctrl+Z
 *   会把补段撤没、又触发 appendTransaction 补回，死循环）。
 */
// 扫描顶层 table/image：后随非文本块（或到文档末尾）时补空段落。返回 tr 或 null。
const fixStructuralParagraphs = (state) => {
    const { doc, schema } = state;
    const para = schema.nodes.paragraph;
    if (!para) return null;
    const children = [];
    doc.forEach((n, off) => children.push({ n, off }));
    const tr = state.tr;
    let delta = 0;
    let touched = false;
    for (let i = 0; i < children.length; i++) {
        const { n, off } = children[i];
        if (n.type.name !== 'table' && n.type.name !== 'image') continue;
        const next = children[i + 1];
        if (next && next.n.isTextblock) continue; // 后面已是可点击文本块（段落/标题）
        const p = para.create();
        tr.insert(off + n.nodeSize + delta, p);
        delta += p.nodeSize;
        touched = true;
    }
    return touched ? tr : null;
};

export const StructuralParagraph = Extension.create({
    name: 'structuralParagraph',

    onCreate() {
        // 挂载即补：覆盖"存量文档纯加载、尚未做任何编辑"的路径（appendTransaction 够不着）
        const tr = fixStructuralParagraphs(this.editor.state);
        if (tr) this.editor.view.dispatch(tr.setMeta('addToHistory', false));
    },

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('structuralParagraph'),
                appendTransaction: (transactions, _oldState, state) => {
                    if (!transactions.some((tr) => tr.docChanged)) return null;
                    return fixStructuralParagraphs(state);
                }
            })
        ];
    }
});
