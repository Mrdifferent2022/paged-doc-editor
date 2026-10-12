/**
 * 上传即转换（不开弹窗）：DXF File → cadDrawing 节点 attrs。
 * （仅 DXF：DWG 需要 GPL-3.0 的 libredwg 转换器，本包不内置，见 README「CAD 支持」）
 *
 * 流程：隐藏容器（fixed 屏外、真实 1200×800 尺寸——viewer 挂载要量容器）挂 MlCadViewer
 * → openDocument 打开 → 白底黑白 PNG 快照（cadSnapshot.js，编辑器同款渲染管线）→ 卸载。
 * 图纸源 data 存**原始文件内容**（不走 dxfOut，无损保真）：dxf 文本存 utf8，二进制 dxf 存 base64。
 */
import { mountMlCadViewer } from './mlightcadMount.js';

export const CAD_MAX_BYTES = 10 * 1024 * 1024; // 图纸源内嵌 doc JSON，>10MB 拒绝（体积/指纹保存开销）

export const isCadFileName = (name) => /\.dxf$/i.test(name || '');

const BINARY_DXF_MAGIC = 'AutoCAD Binary DXF';

const fileToNodeData = async (file) => {
    const buf = await file.arrayBuffer();
    // 二进制判定：dxf 看魔数（二进制 DXF 以 "AutoCAD Binary DXF" 开头）
    const head = new TextDecoder().decode(buf.slice(0, 24));
    if (head.startsWith(BINARY_DXF_MAGIC)) {
        // base64（分块防栈溢出）
        let bin = '';
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        return { data: btoa(bin), enc: 'base64', fmt: 'dxf' };
    }
    return { data: new TextDecoder('utf-8').decode(buf), enc: 'utf8', fmt: 'dxf' };
};

/**
 * @param {File} file dxf 文件
 * @returns {Promise<{data,enc,fmt,name,preview}>} cadDrawing 节点 attrs（preview 可能为 null=空图纸）
 */
export async function convertCadFileToNodeAttrs(file) {
    if (!isCadFileName(file?.name)) throw new Error('仅支持 .dxf 文件');
    if (file.size > CAD_MAX_BYTES) throw new Error(`图纸过大（${(file.size / 1024 / 1024).toFixed(1)}MB > 10MB），请精简后再插入`);

    const container = document.createElement('div');
    // 屏外但真实尺寸：viewer 挂载时量容器定画布，display:none 会得到 0×0
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;pointer-events:none;visibility:hidden;';
    document.body.appendChild(container);
    let handle = null;
    try {
        handle = await mountMlCadViewer(container);
        await handle.openFile(file);
        const preview = await handle.snapshotPng();
        const { data, enc, fmt } = await fileToNodeData(file);
        return { data, enc, fmt, name: file.name, preview };
    } finally {
        try { handle?.unmount(); } catch { /* best effort */ }
        container.remove();
    }
}
