import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { colwidthTotal, scaleTableColwidths, tableLimitPx } from './tableUtils.js';

/**
 * 拖列钳制（table 宽 = min(Σcolwidth, 版心) 的不变量维护）：
 * prosemirror-tables 的列宽拖拽只改被拖列 colwidth、邻列零补偿，Σ 可超版心导致表格右缘溢出页面。
 * 拖拽 mousemove 只走 DOM 预览、mouseup 才 dispatch，所以 appendTransaction 同步追加收缩事务无跳动；
 * prosemirror-history 会把追加事务并入同一历史事件，Ctrl+Z 一次同时撤销拖拽+钳制。
 * 部分列有 colwidth 的混合态不钳（CSS width:100% 自治，结构上不溢出）。
 */
export const TableWidthClamp = Extension.create({
    name: 'tableWidthClamp',

    addProseMirrorPlugins() {
        let view = null;
        return [
            new Plugin({
                key: new PluginKey('tableWidthClamp'),
                view(v) {
                    view = v;
                    return {};
                },
                appendTransaction(trs, _old, newState) {
                    if (!view || !trs.some((t) => t.docChanged)) return null;
                    let tr = null;
                    newState.doc.descendants((node, pos) => {
                        if (node.type.name !== 'table') return true;
                        const total = colwidthTotal(node);
                        if (total == null) return false; // 无/部分 colwidth：CSS 100% 自治
                        const limit = tableLimitPx(view, pos);
                        if (!limit || total <= limit + 1) return false; // +1 容差防抖
                        tr = tr ?? newState.tr;
                        scaleTableColwidths(tr, pos, node, limit / total);
                        return false; // 不深入嵌套表
                    });
                    // min 触底无实际变更时 bail，防止 appendTransaction 自触发死循环
                    return tr && tr.docChanged ? tr : null;
                }
            })
        ];
    }
});
