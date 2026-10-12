import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';

/**
 * 光标所在单元格高亮：用 node Decoration 实现（PM 每次事务自动维护），
 * 比手动给 DOM 加 class 可靠——后者会被 ProseMirror 重绘抹掉。
 * 装饰不进 JSON，服务端渲染零感知。
 * 注意：多选（CellSelection）时让位——整体外框高亮由 TableFloatingMenu 的覆盖层描边负责。
 */
export const ActiveCell = Extension.create({
    name: 'activeCell',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('activeCell'),
                props: {
                    decorations(state) {
                        const { selection } = state;
                        if (selection instanceof CellSelection) return null; // 多选走整体外框
                        const { $from } = selection;
                        for (let d = $from.depth; d > 0; d--) {
                            const name = $from.node(d).type.name;
                            if (name === 'tableCell' || name === 'tableHeader') {
                                const pos = $from.before(d);
                                return DecorationSet.create(state.doc, [
                                    Decoration.node(pos, pos + $from.node(d).nodeSize, { class: 'active-cell' })
                                ]);
                            }
                        }
                        return null;
                    }
                }
            })
        ];
    }
});

