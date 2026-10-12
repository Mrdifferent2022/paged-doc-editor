import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { fieldStore } from '../fields-store.js';

/**
 * field —— 可填充字段（inline atom）
 * attrs:
 *   key      字段标识（模板传参填充时按 key 匹配）
 *   label    占位提示
 *   value    当前值
 *   bindKey  联动键：相同 bindKey 的字段跨表/跨节同步
 *   locked   true 时只读（字段级编辑权限控制）
 */
// input 的 size 属性 1 单位≈西文字符宽，CJK 全角字≈2 单位——直接用 value.length 会把
// "适用范围"这类中文值裁掉一半（用户 2026-08-28 投诉章节号/章节名称"被隐藏"，实测只剩前两个字）
// CJK 表意文字 ⺀-鿿、CJK 标点 　-〿、全角形式 ＀-￯ 计 2 个西文宽度
const visualLen = (s) => [...(s || '')].reduce((n, c) => n + (/[⺀-鿿　-〿＀-￯]/.test(c) ? 2 : 1), 0);
// tight（锁定字段=直接文本）：宽度紧贴内容——取 值|占位 的实际长度，不取两者 max，
// 否则 "03" 这类短值会按占位"章节号"撑出 3 字空档，章节号与章节名称看着离得远（用户 2026-08-28）
// 宽度落地：input 的 size 属性按浏览器估值字宽（≈最大字宽）算，"03"/"3.1" 这类数字短值能多空出
// 2-3 个空格宽（实测 size=2 → 32px，"03" 字形仅 ~21px）——用镜像 span 实测文本像素宽覆盖（用户 2026-09-04：
// 章节编号与章节名称间隔太大，就留一个空格）。镜像随 DOM 继承 H1 字体，offsetWidth 与 style.width 同为未缩放坐标（坑#35）
const fitSize = (input, tight = false, mirror = null) => {
    input.size = tight
        ? Math.max(visualLen(input.value || input.placeholder), 1)
        : Math.max(visualLen(input.value), visualLen(input.placeholder), 2);
    if (!mirror) return;
    const shown = tight ? input.value || input.placeholder : visualLen(input.value) >= visualLen(input.placeholder) ? input.value : input.placeholder;
    mirror.textContent = shown || '​';
    const w = mirror.offsetWidth;
    if (w === 0) return; // 屏外 content-visibility 未排版：保留 size 兜底，不覆盖像素宽
    input.style.width = `${Math.ceil(w) + (tight ? 2 : 6)}px`; // tight 留 2px 防取整裁字；可编辑留打字余量（另有 padding 0 2px）
};

// 锁定区域守卫：含 locked 字段的文本块（正文顶部章节大标题 H1）整体禁删禁改。
// locked 只禁用 input——PM 仍可选中删除原子节点、在 H1 行内打字（用户 2026-08-28 投诉"可以被删掉可以被编辑"）。
// filterTransaction：任何改动范围与锁定文本块相交的交易整块拒绝（边界处插入不算相交，前后正常打字不受影响）；
// fillParams/applySignatures 走 sections 重建不经过编辑器交易，不受影响
export const LockedRegionGuard = Extension.create({
    name: 'lockedRegionGuard',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('lockedRegionGuard'),
                filterTransaction: (tr, state) => {
                    if (!tr.docChanged) return true;
                    const locked = [];
                    state.doc.descendants((node, pos) => {
                        if (!node.isTextblock) return true;
                        let has = false;
                        node.forEach((child) => {
                            if (child.type.name === 'field' && child.attrs.locked) has = true;
                        });
                        if (has) locked.push([pos, pos + node.nodeSize]);
                        return false;
                    });
                    if (!locked.length) return true;
                    for (const map of tr.mapping.maps) {
                        let blocked = false;
                        map.forEach((from, to) => {
                            if (locked.some(([s, e]) => from < e && to > s)) blocked = true;
                        });
                        if (blocked) return false;
                    }
                    return true;
                }
            })
        ];
    }
});

export const Field = Node.create({
    name: 'field',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
        return {
            key: { default: '' },
            label: { default: '' },
            value: { default: '' },
            bindKey: { default: null },
            locked: { default: false }
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-field]' }];
    },

    renderHTML({ node }) {
        return [
            'span',
            mergeAttributes({ 'data-field': node.attrs.key, class: 'doc-field' }),
            node.attrs.value || `［${node.attrs.label}］`
        ];
    },

    addNodeView() {
        return ({ node, editor, getPos }) => {
            const dom = document.createElement('span');
            dom.classList.add('doc-field');
            dom.dataset.field = node.attrs.key;

            const input = document.createElement('input');
            input.classList.add('doc-field-input');
            input.value = node.attrs.value || '';
            input.placeholder = node.attrs.label || node.attrs.key;
            // 镜像 span：与 input 同 DOM 上下文继承字体，实测文本像素宽（见 fitSize 注释）
            const mirror = document.createElement('span');
            mirror.classList.add('doc-field-mirror');
            mirror.setAttribute('aria-hidden', 'true');
            fitSize(input, node.attrs.locked, mirror);
            // nodeView 创建时还没挂进文档，镜像量不出（offsetWidth=0 被守卫跳过）——挂载后下一帧补量
            requestAnimationFrame(() => fitSize(input, node.attrs.locked, mirror));

            let unsubscribe = null;

            const syncFromStore = (val) => {
                if (input.value === val) return;
                input.value = val;
                fitSize(input, node.attrs.locked, mirror);
                // 回写本节点 attrs，保证导出 JSON 一致
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (pos != null) {
                    editor.view.dispatch(
                        editor.state.tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            value: val
                        })
                    );
                }
            };

            const onInput = () => {
                const val = input.value;
                fitSize(input, node.attrs.locked, mirror);
                const pos = typeof getPos === 'function' ? getPos() : null;
                if (pos != null) {
                    editor.view.dispatch(
                        editor.state.tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            value: val
                        })
                    );
                }
                if (node.attrs.bindKey) {
                    fieldStore.setValue(node.attrs.bindKey, val, syncFromStore);
                }
            };

            input.addEventListener('input', onInput);

            const applyEditable = () => {
                const editable = editor.isEditable && !node.attrs.locked;
                input.disabled = !editable;
                dom.classList.toggle('doc-field-locked', !editable);
            };
            applyEditable();
            editor.on('transaction', applyEditable);

            if (node.attrs.bindKey) {
                unsubscribe = fieldStore.subscribe(node.attrs.bindKey, syncFromStore);
            }

            dom.appendChild(input);
            dom.appendChild(mirror); // 在 input 后挂镜像（absolute 定位脱流，顺序无关）

            return {
                dom,
                update(updated) {
                    if (updated.type.name !== 'field') return false;
                    node = updated;
                    if (document.activeElement !== input) {
                        input.value = updated.attrs.value || '';
                        fitSize(input, updated.attrs.locked, mirror);
                    }
                    applyEditable();
                    return true;
                },
                destroy() {
                    input.removeEventListener('input', onInput);
                    editor.off('transaction', applyEditable);
                    unsubscribe?.();
                }
            };
        };
    }
});
