<script setup>
import { computed, ref } from 'vue';
import { SectionedEditor, buildTemplateSections, buildBlankSections, fillParams, applySignatures, templateMeta, fieldStore } from '@editor/index.js';

/**
 * 演示壳：模拟宿主应用的集成方式。
 * 应用级动作（新建传参 / 只读 / 签章 / 定版预览 / 导出）在这里；
 * 编辑体验全部由包内 <SectionedEditor> 提供。
 */
// 初始加载即走 fillParams：示例参数让页眉标题/二维码（stdName）/默认邮箱当场生效，
// 与宿主新建流一致（宿主：fillParams(tpl, {stdName:文件名, stdNo:临时编号, preparedBy:创建人})）
const DEMO_PARAMS = {
    stdName: '工艺标准文件', stdNo: 'DOC-2026-0001', // 大标准（页眉）
    verNo: 'V001', // 页眉版本格（宿主由版本序号组装）
    chapNo: '03', chapName: '示例零件加工工艺', // 本文件=大标准的一章
    projectName: '示例项目', lineNo: 'L3', partName: '示例零件', preparedBy: '张三'
};
// 英文示例参数（中英双模板）：切换语言时用整套英文值重建，避免中英混排
const DEMO_PARAMS_EN = {
    stdName: 'Process Standard Document', stdNo: 'DOC-2026-0001',
    verNo: 'V001',
    chapNo: '03', chapName: 'Example Part Process',
    projectName: 'Demo Project', lineNo: 'L3', partName: 'Example Part', preparedBy: 'zhangsan'
};
// 文档语言：模板生成/编辑器字体栈（lang-en）/渲染 Times 栈全走它。
// 支持 ?lang=en 启动参数整壳以英文模板挂载（按钮切换因节 id 固定 Vue 复用 LazySection 实例、正文编辑器不重建，
// 只能换页眉页脚带——探针/人工验证英文正文须用 URL 参数冷启动）
const docLang = ref(new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh');
const demoParams = () => (docLang.value === 'en' ? DEMO_PARAMS_EN : DEMO_PARAMS);
const sections = ref(fillParams(buildTemplateSections(docLang.value), demoParams()));
const editable = ref(true);
const zoom = ref(1);
const visualPagination = ref(true);
const showParamDialog = ref(false);
const paramForm = ref({});
const exporting = ref(false);
const previewing = ref(false);
const editorRef = ref(null);

// 无头验证脚本钩子：走真实 getPayload → /render 导出路径（debug-*.js 用）
// unlockHf：解开节级页眉页脚锁——模板默认 headerEditable/footerEditable:false（锁定双击不进编辑），
// debug-hf-edit 这类测"页眉编辑回路"的脚本先调它再测
window.__app = {
    getPayload: () => editorRef.value?.getPayload(),
    unlockHf: () => sections.value.forEach((s) => { s.headerEditable = true; s.footerEditable = true; })
};

// 进入编辑的权限校验钩子（demo 用 confirm 模拟；宿主换成真实权限接口，异步也可）
const onRequestEdit = () => {
    if (window.confirm('模拟权限校验：当前用户拥有编辑权限？')) editable.value = true;
};
const onRequestReadonly = () => (editable.value = false);

// 缩放下拉：预设档位 + Ctrl 滚轮产生的任意 0.1 步进值（动态补一个选项，避免 select 显示空白）
const ZOOM_PRESETS = [0.75, 1, 1.25, 1.5];
const zoomOptions = computed(() => {
    const opts = [...ZOOM_PRESETS];
    if (!opts.includes(zoom.value)) opts.push(zoom.value);
    return opts.sort((a, b) => a - b).map((z) => ({ value: z, label: Math.round(z * 100) + '%' }));
});

templateMeta.params.forEach((p) => (paramForm.value[p.key] = ''));

const applyParams = () => {
    sections.value = fillParams(buildTemplateSections(docLang.value), paramForm.value);
    signed.value = false;
    Object.entries(paramForm.value).forEach(([k, v]) => fieldStore.setValue(k, v));
    showParamDialog.value = false;
};

// 中英模板切换：按当前语言重建完整模板（宿主是两份物理模板按 file_lang 取；PoC 演示同源 buildTemplateSections(lang)）
const switchLang = () => {
    docLang.value = docLang.value === 'zh' ? 'en' : 'zh';
    sections.value = fillParams(buildTemplateSections(docLang.value), demoParams());
    signed.value = false;
};

// 空白模板（2页仅页眉页脚，无 A3 节）：示例参数让页眉标题/二维码/章节行当场生效
const loadBlank = () => {
    const dp = demoParams();
    sections.value = fillParams(buildBlankSections(docLang.value), { stdName: dp.stdName, stdNo: dp.stdNo, verNo: dp.verNo, chapNo: dp.chapNo, chapName: dp.chapName });
    signed.value = false;
};

// 模拟 worker 签章：回填页脚签名条（sections 是宿主的响应式数据，改了即更新）
const signed = ref(false);
const simulateSign = () => {
    // signedAt 必须给：{{sigDate}} 取各角色 signedAt 最大值，缺省全部 undefined → 日期落 '—'；
    // signedBy 随文档语言：中文文档签汉字（KaiTi 正楷 SVG），英文文档签拼音（Times 斜体 SVG）
    const names =
        docLang.value === 'en'
            ? { submitter: 'zhangsan', checker: 'lisi', auditor: 'wangwu', approver: 'zhaoliu' }
            : { submitter: '张三', checker: '李四', auditor: '王五', approver: '赵六' };
    const sigs = signed.value
        ? {}
        : {
              submitter: { signedBy: names.submitter, signedAt: '2026-08-20' },
              checker: { signedBy: names.checker, signedAt: '2026-08-21' },
              auditor: { signedBy: names.auditor, signedAt: '2026-08-22' },
              approver: { signedBy: names.approver, signedAt: '2026-08-24' }
          };
    const next = applySignatures(sections.value, sigs, { lang: docLang.value }); // 未签兜底文案随语言（待签署/Pending）
    sections.value.forEach((s, i) => {
        s.footer = next[i].footer;
    });
    signed.value = !signed.value;
};

const renderPDF = async () => {
    const resp = await fetch('http://localhost:8200/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: editorRef.value.getPayload(), lang: docLang.value }) // lang → 渲染侧 Times 优先栈 + <html lang>
    });
    if (!resp.ok) throw new Error(`渲染失败: ${resp.status}`);
    return URL.createObjectURL(await resp.blob());
};

// 定版预览：新标签页打开渲染 PDF（视觉分页是近似，真实分页以此为准）
const previewPDF = async () => {
    previewing.value = true;
    try {
        window.open(await renderPDF(), '_blank');
    } catch (e) {
        alert(e.message + '\n（请确认 render-server 已启动：npm run render-server）');
    } finally {
        previewing.value = false;
    }
};

const exportPDF = async () => {
    exporting.value = true;
    try {
        const url = await renderPDF();
        const a = document.createElement('a');
        a.href = url;
        a.download = 'paged-doc-demo.pdf';
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert(e.message + '\n（请确认 render-server 已启动：npm run render-server）');
    } finally {
        exporting.value = false;
    }
};

// 打印：渲染定版 PDF 后用隐藏 iframe 调起系统打印（编辑态不直接 window.print，保证打印的是定版分页）
const printPDF = async () => {
    try {
        const url = await renderPDF();
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = url;
        document.body.appendChild(iframe);
        iframe.onload = () => iframe.contentWindow.print();
    } catch (e) {
        alert(e.message + '\n（请确认 render-server 已启动：npm run render-server）');
    }
};
</script>

<template>
    <div class="app-shell">
        <header class="toolbar">
            <span class="title">paged-doc-editor demo</span>
            <button @click="switchLang">{{ docLang === 'zh' ? '切换 English 模板' : '切换中文模板' }}</button>
            <button @click="showParamDialog = true">新建（传参）</button>
            <button @click="loadBlank">空白模板（2页）</button>
            <button @click="simulateSign">{{ signed ? '撤销签章' : '模拟签章' }}</button>
            <button @click="visualPagination = !visualPagination">{{ visualPagination ? '关视觉分页' : '开视觉分页' }}</button>
            <button :disabled="previewing" @click="previewPDF">{{ previewing ? '渲染中…' : '定版预览' }}</button>
            <!-- 编辑/只读切换与导出 PDF 在包内右键菜单（只读态包内工具栏整条隐藏）；缩放也可在正文上 Ctrl+滚轮 -->
            <select v-model.number="zoom" class="zoom-select">
                <option v-for="o in zoomOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
        </header>

        <div v-if="showParamDialog" class="dialog-mask" @click.self="showParamDialog = false">
            <div class="dialog">
                <h3>新建文档 — 传参填充</h3>
                <p class="dialog-tip">标准名称 / 标准编号将进入页眉，每页重复</p>
                <div v-for="p in templateMeta.params" :key="p.key" class="form-row">
                    <label>{{ p.label }}</label>
                    <input v-model="paramForm[p.key]" :placeholder="p.label" />
                </div>
                <div class="dialog-actions">
                    <button @click="applyParams">创建并填充</button>
                    <button @click="showParamDialog = false">取消</button>
                </div>
            </div>
        </div>

        <SectionedEditor
            ref="editorRef" :sections="sections" :lang="docLang" :editable="editable" v-model:zoom="zoom" :visual-pagination="visualPagination"
            :exporting="exporting"
            @request-edit="onRequestEdit" @request-readonly="onRequestReadonly"
            @preview="previewPDF" @export-pdf="exportPDF" @print="printPDF"
        />
    </div>
</template>
