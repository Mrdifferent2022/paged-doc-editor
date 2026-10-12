/**
 * paged-doc-editor —— 分页文档编辑器（Tiptap 多节版式编辑器）
 *
 * 宿主应用用法：
 *   import { SectionedEditor, buildTemplateSections, fillParams, applySignatures } from 'paged-doc-editor';
 *   import 'paged-doc-editor/styles';
 *
 *   const sections = ref(fillParams(buildTemplateSections(), params));
 *   <SectionedEditor :sections="sections" :editable="canEdit" :zoom="1" ref="ed" />
 *   ed.value.getPayload() → POST 渲染服务（混合纸张定版 PDF）
 */
export { default as SectionedEditor } from './components/SectionedEditor.vue';
export { default as SectionEditor } from './components/SectionEditor.vue';
export { default as EditorToolbar } from './components/EditorToolbar.vue';

export { buildExtensions } from './tiptap/index.js';
export { Field, PageBreak, SignatureField, TableCellBg, TableHeaderBg } from './tiptap/index.js';
export { VisualPagination } from './tiptap/VisualPagination.js';

export { mmToPx, PAGE_DIMS_MM, BASE_MARGINS_MM, BASE_MARGINS_MM as MARGINS_MM, BASE_BODY_PAD_MM, paperSizeMm, computePageLayout } from './layout/pageLayout.js';
export { resolveStories, fillHfPreview } from './layout/stories.js';
export { buildTemplateSections, buildBlankSections, buildSection, fillParams, applySignatures, resetSignatures, composeVerNo, setHeaderVerNo, templateMeta, stories, pageSpec } from './templates/standardTemplate.js';
export { fieldStore } from './fields-store.js';
export { setDocEditorNotifier, notify } from "./notify.js";
