/**
 * CAD 图纸 → 白底 PNG 快照（占位区预览的单一事实源，2026-09-23 二轮）。
 *
 * 为什么弃 SVG（cadSvg.js 已删）：cad-svg-plugin 导出的是 <text font-family="CAD字体名">
 * 元素——<img> 内 SVG 不能加载 web 字体、SHX 字体操作系统里没有 → 汉字/标注全 fallback
 * 错位（用户实测"转换成图片后显示不对劲"）。PNG 走编辑器同款 WebGL 渲染管线
 * （AcApRasterImageConvertor = pngout 命令本体，离屏 WebGLRenderTarget + readRenderTargetPixels，
 * 不依赖 preserveDrawingBuffer），文字是已加载字体的字形矢量 mesh，所见即所得。
 *
 * 白底：view.backgroundColor=0xffffff（setter 内部 applyCanvasBackground 联动 ACI-7 前景反黑），
 * 快照完恢复原背景。强制黑白（用户拍板）：像素级亮度压黑——近白→纯白、深色→纯黑、
 * 中间带线性灰度过渡（抗锯齿边不糊）。
 */

// 单色化：亮度 ≤110 压纯黑、≥235 归纯白、之间线性过渡（彩色图层线条一并压黑）
const monochromePng = (dataUrl) =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0);
                const d = ctx.getImageData(0, 0, c.width, c.height);
                const a = d.data;
                for (let i = 0; i < a.length; i += 4) {
                    const lum = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
                    const v = lum >= 235 ? 255 : lum <= 110 ? 0 : Math.round(((lum - 110) * 255) / 125);
                    a[i] = a[i + 1] = a[i + 2] = v;
                    a[i + 3] = 255;
                }
                ctx.putImageData(d, 0, 0);
                resolve(c.toDataURL('image/png'));
            } catch {
                resolve(dataUrl); // 后处理失败不丢图——退回彩色快照
            }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });

/**
 * 当前文档全图快照为白底黑白 PNG dataURL。
 * @param simpleMod @mlightcad/cad-simple-viewer 模块命名空间（mlightcadMount 的 loadMods 缓存）
 * @param longSide 长边像素（默认 2400，A4 满宽约 360dpi）
 * @returns {Promise<string|null>} 无视图/导出失败 → null（调用方保留旧预览）
 */
export async function snapshotCadPng(simpleMod, longSide = 2400) {
    const { AcApDocManager, AcApRasterImageConvertor } = simpleMod ?? {};
    const mgr = AcApDocManager?.tryGetInstance?.();
    const view = mgr?.curView;
    if (!view || !AcApRasterImageConvertor) return null;
    // 空图纸不出预览（旧 SVG 路径同款语义）：空白文档 dxfOut/快照都有内容（默认表数据/全白图），
    // 不拦的话空占位区会被写成一张全白 PNG（探针 3b 踩过）
    const it = mgr?.curDocument?.database?.tables?.blockTable?.modelSpace?.newIterator?.();
    let hasEntity = false;
    if (it) for (const _ent of it) { hasEntity = true; break; }
    if (!hasEntity) return null;
    const oldBg = view.renderer?.currentBackgroundColor;
    try {
        // 快照前回全图——用户在弹窗里缩放/平移过，直接拍会写出局部视图
        view.zoomToFitDrawing?.();
        await view.waitUntilIdle?.(15000); // 等字体/文字几何就绪（convert 内部还会再兜一次）
        view.backgroundColor = 0xffffff;
        let out = null;
        const conv = new AcApRasterImageConvertor('png');
        // convert() 终点是触发浏览器下载——实例级猴补丁截获 dataURL（encodeDataUrl 是原型方法）
        conv.createFileAndDownloadIt = function (canvas, pixels, w, h) {
            out = this.encodeDataUrl(canvas, pixels, w, h);
        };
        await conv.convert(undefined, longSide); // 不传 bounds = 当前 fitted 视图（内部居中裁剪算式）
        if (!out) return null;
        return await monochromePng(out);
    } catch (err) {
        console.warn('[cadSnapshot] PNG 快照失败：', err);
        return null;
    } finally {
        if (oldBg != null) {
            try { view.backgroundColor = oldBg; } catch { /* best effort */ }
        }
    }
}
