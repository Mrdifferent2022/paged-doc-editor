<script setup>
import { nextTick, ref } from 'vue';
import Dialog from 'primevue/dialog';
import { mountMlCadViewer } from '../cad/mlightcadMount.js';
import { CAD_MAX_BYTES, isCadFileName } from '../cad/cadConvert.js';
import { notify } from '../notify.js';

/**
 * CAD 图纸编辑弹窗（2026-09-23）：双击正文 cadDrawing 占位区打开。
 * - 有图纸源（attrs.data）：直接打开；无源：空画布 + createDefaultData 补丁（进去即可画，
 *   无需手动新建——补丁在 mlightcadMount.js）
 * - 弹窗内可拖拽/浏览换图纸（打开 DXF）；编辑过（session-db-edit-committed）置脏
 * - 关闭（@hide）：先写回（dxfOut + 白底黑线 SVG 快照 → setNodeMarkup）再卸载编辑器——
 *   dxfOut 必须在 doc 存活时取（DxfCard.vue 时序）
 * - 只读文档：可开弹窗查看，关闭不写回
 *
 * 结构铁律（参考件）：挂载点必须是独立空 div，loading/错误浮层只能是它的兄弟节点——
 * 卸载时 mountEl.innerHTML='' 会抹掉容器内一切，浮层若在容器内，宿主 Vue 持有的
 * vnode 就成野引用，下次 patch 报 insertBefore null。
 */

const visible = ref(false);
const busy = ref(false); // 加载图纸/生成预览中
const busyText = ref('');
const loadError = ref('');
const openedName = ref(''); // 弹窗标题 + 写回的 name（换图后跟随最新文件）
const mountEl = ref(null);
const fileInput = ref(null);

let cad = null; // mlightcad 挂载 handle
let target = null; // { editor, pos } 写回落点
let editableOnOpen = false;

// attrs.data → File（enc: utf8 文本 | base64 二进制）
const attrsToFile = (attrs) => {
    if (!attrs?.data) return null;
    const name = attrs.name || `drawing.${attrs.fmt || 'dxf'}`;
    if (attrs.enc === 'base64') {
        const bin = atob(attrs.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], name);
    }
    return new File([attrs.data], name, { type: 'application/dxf' });
};

/** SectionedEditor 双击委托调用：payload={ editor, pos } */
const open = ({ editor, pos }) => {
    const node = editor?.state?.doc?.nodeAt(pos);
    if (!node || node.type.name !== 'cadDrawing') return;
    target = { editor, pos };
    editableOnOpen = editor.isEditable;
    openedName.value = node.attrs.name || '';
    loadError.value = '';
    visible.value = true; // @show 后再挂编辑器（viewer 挂载要量容器，v-show 隐藏时 0×0）
};

const onShow = async () => {
    await nextTick();
    if (!mountEl.value || !target) return;
    busy.value = true;
    busyText.value = '正在加载 CAD 编辑器…';
    try {
        cad = await mountMlCadViewer(mountEl.value);
        const attrs = target.editor.state.doc.nodeAt(target.pos)?.attrs ?? {};
        const file = attrsToFile(attrs);
        if (file) {
            busyText.value = '正在打开图纸…';
            await cad.openFile(file);
            cad.clearDirty(); // 初始打开不算用户编辑——未动过关闭时不重写
        }
    } catch (err) {
        loadError.value = err?.message || String(err);
    } finally {
        busy.value = false;
    }
};

// —— 弹窗内换图：拖拽（浏览按钮按用户要求删除——工具条多此一举） ——
const onFilePicked = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) loadNewFile(f);
};
const onDrop = (e) => {
    e.preventDefault();
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => isCadFileName(x.name));
    if (f) loadNewFile(f);
    else if (e.dataTransfer?.files?.length) notify.warn('仅支持 .dxf 文件');
};
const loadNewFile = async (file) => {
    if (!cad || busy.value) return; // 打开中不接收新文件（openDocument 并发会竞态丢写回）
    if (!isCadFileName(file.name)) return notify.warn('仅支持 .dxf 文件');
    if (file.size > CAD_MAX_BYTES) return notify.warn(`图纸过大（${(file.size / 1024 / 1024).toFixed(1)}MB > 10MB）`);
    if (cad.isDirty() && !window.confirm('载入新图纸将丢弃当前未保存的修改，继续？')) return;
    busy.value = true;
    busyText.value = '正在打开图纸…';
    loadError.value = '';
    try {
        await cad.openFile(file);
        openedName.value = file.name; // dirty 由 openFile 置位——换图即须写回
    } catch (err) {
        loadError.value = err?.message || String(err);
    } finally {
        busy.value = false;
    }
};

// —— 关闭写回：dxfOut + SVG 快照必须在 doc 存活时取，写完才卸载 ——
const onHide = async () => {
    const t = target;
    const c = cad;
    target = null;
    if (!c) return;
    try {
        const curAttrs = t?.editor?.state?.doc?.nodeAt(t.pos)?.attrs;
        if (t && curAttrs && (c.isDirty() || !curAttrs.preview)) {
            if (!editableOnOpen) {
                if (c.isDirty()) notify.warn('只读文档，本次修改未保存');
            } else {
                const data = c.dxfOut();
                const preview = await c.snapshotPng(); // 白底黑白 PNG（cadSnapshot.js）
                if (data) {
                    t.editor.view.dispatch(
                        t.editor.state.tr.setNodeMarkup(t.pos, undefined, {
                            ...curAttrs,
                            data,
                            enc: 'utf8', // dxfOut 只出 DXF 文本
                            fmt: 'dxf',
                            name: openedName.value || curAttrs.name,
                            preview: preview ?? curAttrs.preview, // 空图纸不覆盖既有预览
                            crop: c.isDirty() ? null : curAttrs.crop // 编辑过内容 bbox 可能变，旧裁剪窗口作废防错位
                        })
                    );
                }
            }
        }
    } catch (err) {
        console.warn('[CadEditorDialog] 写回失败：', err);
        notify.error('CAD 图纸写回失败，本次修改未保存'); // 用户编辑成果丢失——须可见提醒（toast），不能只落 console
    } finally {
        c.unmount();
        cad = null;
    }
};

defineExpose({ open, loadNewFile }); // loadNewFile 暴露给探针直驱换图（合成 change 事件在 Dialog 内 Vue 不响应）
</script>

<template>
    <Dialog
        v-model:visible="visible" modal maximizable :close-on-escape="false"
        :style="{ width: '95vw', maxWidth: '1600px' }"
        :content-style="{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '82vh' }"
        @show="onShow" @hide="onHide"
    >
        <template #header>
            <span class="cad-dialog-title">
                <i class="pi pi-cad"></i>
                CAD 图纸{{ openedName ? `：${openedName}` : '' }}{{ editableOnOpen ? '' : '（只读，修改不保存）' }}
            </span>
        </template>
        <div class="cad-dialog-body" @dragover.prevent @drop="onDrop">
            <div class="cad-editor-wrap">
                <!-- 挂载点必须独立空 div（卸载 innerHTML='' 铁律），浮层只做兄弟节点 -->
                <div ref="mountEl" class="cad-mount"></div>
                <div v-if="busy" class="cad-overlay">
                    <i class="pi pi-spin pi-refresh"></i>
                    <span>{{ busyText }}</span>
                </div>
                <div v-else-if="loadError" class="cad-overlay">
                    <i class="pi pi-exclamation-triangle"></i>
                    <span>{{ loadError }}</span>
                </div>
            </div>
            <input ref="fileInput" type="file" accept=".dxf" style="display: none" @change="onFilePicked" />
        </div>
    </Dialog>
</template>

<style scoped>
.cad-dialog-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.cad-dialog-title .pi-cad { color: #0ea5e9; font-size: 18px; }
.cad-dialog-body { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.cad-editor-wrap { position: relative; flex: 1; min-height: 0; background: #f8fafc; }
.cad-mount { position: absolute; inset: 0; overflow: hidden; }
.cad-overlay {
    position: absolute; inset: 0; z-index: 5;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    background: #fff; color: #94a3b8; font-size: 12px; padding: 16px; text-align: center;
}

/* MlCadViewer 根容器/悬浮工具条是 fixed 全视口布局（独立应用设计），嵌进 Dialog 会盖住
   标题栏——收编为容器内绝对定位（参考件同款） */
.cad-mount :deep(.ml-cad-viewer-container) { position: absolute; }
.cad-mount :deep(.ml-vertical-toolbar-container) { position: absolute; }
/* 加载圈中心的 mlightcad "ML" 品牌图标（无 prop 可关）——产品内不展示第三方品牌 */
.cad-mount :deep(.ml-ccl-spinner-icon) { display: none; }
</style>
