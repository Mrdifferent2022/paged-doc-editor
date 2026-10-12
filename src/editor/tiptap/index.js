import StarterKit from '@tiptap/starter-kit';
import { Extension, Mark } from '@tiptap/core';
import { TableRow } from '@tiptap/extension-table';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { DocImage, InlineImage } from './image.js';
import { CadDrawing } from './cadDrawing.js';
import { DocParagraph, DocBulletList, DocOrderedList } from './lists.js';
import { DocTable, AlignTableView, TableDomSync } from './tableAlign.js';
import { TableWidthClamp } from './tableWidthClamp.js';
import { Field, LockedRegionGuard } from './Field.js';
import { PageBreak } from './PageBreak.js';
import { StructuralParagraph } from './StructuralParagraph.js';
import { SignatureField } from './SignatureField.js';
import { TableCellBg, TableHeaderBg } from './tableCellBg.js';
import { ActiveCell } from './activeCell.js';

/**
 * 编辑器扩展清单 —— 编辑态（SectionEditor）与服务端渲染（render-server）的单一来源。
 * 新增节点/mark 必须加在这里，两侧才能保持一致。
 * 注意：VisualPagination 是纯视图插件（装饰不进 JSON），不在此清单内，仅编辑态挂载。
 */

// class 保留：模板页眉页脚的 class（hf-head/sig-strip/hf-c/hf-r/sig-img/foot-line/sig-slot 等）是样式载体，
// PM 默认不解析 class → 子编辑器 round-trip 后丢类 → 打印侧样式全塌。内联 style 同理不可靠，对齐一律用类。
// 2026-08-28 补 paragraph：页脚 <p class="foot-line hf-c">  round-trip 丢类 → 退编辑变左对齐+灰线消失（此前 types 只有表格/图片）。
// paragraph 的 doc-caption 由 DocParagraph 自己的 caption 属性负责，这里过滤掉防重复输出
const ClassKeep = Extension.create({
    name: 'classKeep',
    addGlobalAttributes() {
        return [
            {
                types: ['table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'cadDrawing', 'paragraph'],
                attributes: {
                    class: {
                        parseHTML: (el) => {
                            const c = (el.getAttribute('class') || '')
                                .split(/\s+/)
                                .filter((x) => x && x !== 'doc-caption')
                                .join(' ');
                            return c || null;
                        },
                        renderHTML: (attrs) => (attrs.class ? { class: attrs.class } : {})
                    }
                }
            }
        ];
    }
});

// span 类保留（inline mark）：页脚定宽槽 <span class="sig-slot/date-slot/email-slot"> 包占位字段，
// PM 没有对应节点/mark 会剥掉 span → 槽宽机制塌、签章前后标签又跳。
// TextStyle 的 parse 只收带 style 属性的 span（无 style 返回 false），与本 mark 不冲突
const SpanClassKeep = Mark.create({
    name: 'spanClassKeep',
    addAttributes() {
        return {
            class: {
                parseHTML: (el) => el.getAttribute('class'),
                renderHTML: (attrs) => (attrs.class ? { class: attrs.class } : {})
            }
        };
    },
    parseHTML() {
        return [{ tag: 'span[class]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', HTMLAttributes, 0];
    }
});

export function buildExtensions({ structuralParagraph = true } = {}) {
    return [
        // paragraph/bulletList/orderedList 用 lists.js 的扩展版替换（题注段落 + 列表标记样式）
        // link：文档内部链接（href=<docLinkPath><file_key>，相对形式不烘焙环境 base，渲染侧 render.js 展开成绝对 URI）。
        // openOnClick:false —— 点击由宿主接管（SectionedEditor main @click 拦截 → openFileByKey，编辑态不响应点击）；
        // HTMLAttributes:{} 整体替换默认值，去 target=_blank/rel（应用内拦截 + PDF annotation 都用不上）
        StarterKit.configure({
            paragraph: false,
            bulletList: false,
            orderedList: false,
            link: { openOnClick: false, HTMLAttributes: {} }
        }),
        ClassKeep,
        SpanClassKeep,
        DocParagraph,
        DocBulletList,
        DocOrderedList,
        // DocTable：align 属性（窄表左/中/右对齐）+ AlignTableView 只读态 margin 维护（见 tableAlign.js 文件头两个坑）
        DocTable.configure({ resizable: true, View: AlignTableView }),
        TableDomSync, // 编辑态表格 DOM 补写 class/align margin（resizable 时 AlignTableView 不生效，坑 #43 补）
        TableRow,
        TableWidthClamp, // 拖列钳制：Σcolwidth 超版心时等比缩回（appendTransaction，undo 合并为一步）
        TableHeaderBg,
        TableCellBg,
        TextStyle,
        Color,
        FontFamily,
        FontSize,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        DocImage.configure({ inline: false, allowBase64: true }), // 图片：base64 dataURL 直接进 JSON，width/align 属性 inline style 输出（裁剪=替换 src，见 image.js）
        CadDrawing, // CAD 图纸：SVG 预览 + 内嵌图纸源，DOM 与 DocImage 同构（裁剪/缩放通吃 ImageFloatingMenu，见 cadDrawing.js）
        InlineImage, // 行内小图（页眉 logo 等）：<img data-inline> atom 保真（内联 <svg> 会被 PM 剥掉）
        Field,
        LockedRegionGuard, // 含 locked 字段的文本块（章节大标题 H1）整体禁删禁改（见 Field.js）
        PageBreak,
        SignatureField,
        // 结构补段：表格/图片后必须永远有文本块落光标（否则只能落 GapCursor 横向光标）。
        // 仅正文；页眉页脚子编辑器（HeaderFooterEditor）传 structuralParagraph:false——
        // hf-title/foot-contacts 表本就是末尾节点，补段会撑高页眉页脚带
        ...(structuralParagraph ? [StructuralParagraph] : [])
    ];
}

export { Field, LockedRegionGuard, PageBreak, SignatureField, TableCellBg, TableHeaderBg, ActiveCell, DocImage, InlineImage, CadDrawing };
export { DocParagraph, DocBulletList, DocOrderedList, BULLET_TYPES, ORDERED_TYPES } from './lists.js';
export { DocTable, AlignTableView, TableDomSync } from './tableAlign.js';
export { TableWidthClamp } from './tableWidthClamp.js';
export { findTable, colwidthTotal, scaleTableColwidths, tableLimitPx } from './tableUtils.js';
