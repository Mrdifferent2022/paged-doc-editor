import { Node, mergeAttributes } from '@tiptap/core';

/**
 * signatureField —— 签名占位
 * attrs:
 *   role      审批角色 submitter/checker/auditor/reviewer/approver/receiver
 *   label     显示名（编制/校对/审核/批准…）
 *   imageKey  签名图在对象存储的 key（也可直接放 dataURL/URL）
 *   signedBy  签名人
 *   signedAt  签名时间
 */
export const SignatureField = Node.create({
    name: 'signatureField',
    group: 'block',
    atom: true,

    addAttributes() {
        return {
            role: { default: '' },
            label: { default: '' },
            imageKey: { default: null },
            signedBy: { default: null },
            signedAt: { default: null }
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-signature]' }];
    },

    renderHTML({ node }) {
        const { label, signedBy, signedAt, imageKey } = node.attrs;
        const children = [
            ['div', { class: 'doc-signature-label' }, label || '签名'],
            imageKey
                ? ['img', { class: 'doc-signature-img', src: imageKey, alt: label }]
                : ['div', { class: 'doc-signature-empty' }, signedBy ? `${signedBy} ${signedAt || ''}` : '待签署']
        ];
        return ['div', mergeAttributes({ 'data-signature': node.attrs.role, class: 'doc-signature' }), ['div', { class: 'doc-signature-box' }, ...children]];
    }
});
