/**
 * mlightcad 嵌入挂载助手（2026-09-23）——CadEditorDialog 弹窗与 cadConvert 隐藏转换共用。
 *
 * 移植自 beaglar MlCadEditor.vue 的加固逻辑（该文件注释即踩坑记录，全部继承）：
 * ① 编辑器是完整 Vue 应用（自带 element-plus/i18n）——独立 createApp 隔离挂载，不污染宿主 PrimeVue；
 *    全部动态 import，首屏 chunk 不膨胀（模块级 modsPromise 缓存，二次挂载直接复用）
 * ② 空画布 = DocManager 构造期裸空文档，数据库无默认表数据（layer '0'/线型/Model layout 都没有，
 *    画线即 layer not found 刷屏）——须手动 createDefaultData() + setActiveLayout()（=用户要的
 *    "自动创建空文档，进去即可画"的补丁）
 * ③ 库在 document 上泄漏匿名 keydown 监听（1.7.x 未修）：卸载后 AcApDocManager._instance 置空，
 *    ESC/Delete/Ctrl+Z 都打到已销毁 view 上抛错——卸载前把 view._keyHandler.handleKeyDown 换 no-op
 * ④ 库在 ResizeObserver 回调里同步改布局，浏览器抛良性 "ResizeObserver loop" uncaught error——
 *    存活期间吞掉（引用计数：隐藏转换与弹窗可能并存）
 * ⑤ cad-viewer 扩展命令注册带模块级一次性 flag：二次挂载后 attedit 等命令丢失——幂等补注册
 * ⑥ 卸载铁律：mountEl.innerHTML='' 会抹掉容器内一切——挂载点必须独立空 div，浮层只做兄弟节点
 * ⑦ cad-viewer.css 带裸全局规则（body{display:flex} 会把宿主页面顶缩到左侧）——
 *    加载后 CSSOM 摘除 html/body/a/#app 裸规则（sanitizeCadViewerGlobals，不 patch node_modules）
 *
 * 打开文件不走 localFile prop watcher，直接调公开 API：
 *   AcApDocManager.tryGetInstance().openDocument(fileName, ArrayBuffer, { mode:Write, openViewMode:'extents' })
 *   ——返回 Promise<boolean> 即"打开完成"信号（options 全可选，字体懒加载由 mtext-renderer 自理）。
 *
 * 仅支持 DXF：DWG 需要 GPL-3.0 的 @mlightcad/libredwg-* 转换器，本包（MIT）不内置。
 * 宿主如需 DWG：自行安装 GPL 可选包并注册转换器（见 README「CAD 支持」节）。
 */

let modsPromise = null;
const loadMods = () =>
    (modsPromise ??= (async () => {
        // CSS 不用显式 import：cad-viewer.js 自带 `./cad-viewer.css` 与 `element-plus/dist/index.css`
        // 静态导入（1.7.x 的 exports 只放行了包根，'@mlightcad/cad-viewer/style.css'
        // 深路径在我们的 vite 下会直接报 Missing specifier）
        const [vue, viewerMod, simpleMod, elementPlus] = await Promise.all([
            import('vue'),
            import('@mlightcad/cad-viewer'),
            import('@mlightcad/cad-simple-viewer'),
            import('element-plus')
        ]);
        sanitizeCadViewerGlobals(); // ⑦ 摘除 body{display:flex} 等裸全局规则（定义见下，此时样式表已注入）
        return { ...vue, viewerMod, simpleMod, elementPlus };
    })());

// —— ⑦ cad-viewer.css 全局污染摘除（2026-09-23 四轮） ——
// 该 CSS 按独立应用设计，含裸全局规则：body{display:flex}（宿主页面左缩元凶）、
// body{overflow:hidden}（锁宿主滚动）、body{font-family}、body{border-bottom}、a{color}、html{height}。
// 随 chunk 加载后永久生效。这里用 CSSOM 精准删除——不 patch node_modules（重装即丢）。
// 时机安全：dev 下 vite 模块求值时同步注入 style、prod 下 preload helper 等 CSS 就绪才 resolve import。
const GLOBAL_KILL = new Set(['html', 'body', 'html,body', 'a', '#app']);
const normSel = (s) => s.split(',').map((x) => x.trim()).sort().join(',');
const sanitizeCadViewerGlobals = () => {
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules; // CORS 表会抛——逐表跳过
        } catch {
            continue;
        }
        if (!rules?.length) continue;
        // 内容签名定位（不依赖文件名，dev style 标签/prod vendor-@mlightcad-[hash].css 通吃）：
        // 同一 sheet 里既有 .ml-cad-viewer-container 又有 body{display:flex}
        let hasMarker = false;
        let hasBodyFlex = false;
        for (const r of rules) {
            const sel = r.selectorText || '';
            if (sel.includes('.ml-cad-viewer-container')) hasMarker = true;
            else if (normSel(sel) === 'body' && r.style?.display === 'flex') hasBodyFlex = true;
            if (hasMarker && hasBodyFlex) break;
        }
        if (!hasMarker || !hasBodyFlex) continue;
        for (let i = rules.length - 1; i >= 0; i--) {
            const sel = rules[i].selectorText;
            if (sel && GLOBAL_KILL.has(normSel(sel))) sheet.deleteRule(i);
        }
        // :root 变量 / html.dark / .ml-* / .el-* 全保留——viewer 内部要用
    }
};

// —— ④ 库噪音抑制（引用计数） ——
// a) ResizeObserver 回调里同步改布局 → 浏览器抛良性 "ResizeObserver loop" uncaught error
// b) 卸载后库内延迟回调（字体加载完成/setTimeout/rAF）仍调 AcApDocManager.instance 静态 getter
//    （_instance 已置空）→ "AcApDocManager instance is not created yet!" uncaught——卸载后留 5s 宽限期
const NOISE_PATTERNS = ['ResizeObserver loop', 'AcApDocManager instance is not created yet'];
const isLibNoise = (msg) => typeof msg === 'string' && NOISE_PATTERNS.some((p) => msg.includes(p));
let roGuardCount = 0;
let roErrorHandler = null;
let roRejHandler = null;
let roRemoveTimer = null;
const addRoGuard = () => {
    roGuardCount++;
    if (roRemoveTimer) { clearTimeout(roRemoveTimer); roRemoveTimer = null; } // 宽限期内又挂载 → 守卫续命
    if (roErrorHandler) return;
    roErrorHandler = (e) => { if (isLibNoise(e?.message)) e.preventDefault(); };
    roRejHandler = (e) => { if (isLibNoise(e?.reason?.message ?? e?.reason)) e.preventDefault(); };
    window.addEventListener('error', roErrorHandler);
    window.addEventListener('unhandledrejection', roRejHandler);
};
const removeRoGuard = () => {
    if (--roGuardCount > 0 || !roErrorHandler || roRemoveTimer) return;
    // 卸载后延迟回调仍可能砸过来（探针实测：卸载后下一拍才抛）——5s 宽限再摘守卫
    roRemoveTimer = setTimeout(() => {
        roRemoveTimer = null;
        window.removeEventListener('error', roErrorHandler);
        window.removeEventListener('unhandledrejection', roRejHandler);
        roErrorHandler = roRejHandler = null;
    }, 5000);
};

/**
 * 挂载一个 MlCadViewer 嵌套应用到 mountEl（必须是独立空 div）。
 * @param {HTMLElement} mountEl
 * @param {{ cadDataBaseUrl?: string }} [opts] cadDataBaseUrl=mlightcad 字体/模板仓地址
 *   （缺省走库默认 CDN；内网/离线部署时宿主需自备 cad-data 目录并传本地地址，见 README「CAD 支持」）
 * @returns handle { openFile, getDatabase, dxfOut, isDirty, clearDirty, unmount }
 */
export async function mountMlCadViewer(mountEl, opts = {}) {
    addRoGuard();
    const { createApp, h, reactive, viewerMod, simpleMod, elementPlus } = await loadMods();
    const { AcApDocManager, eventBus } = simpleMod;

    // wrapper 仅为了把 props 传给 MlCadViewer（文件打开走 openFile → openDocument，不经 localFile prop）
    // baseUrl 仅在宿主显式提供时设置（缺省 = 库默认 CDN）；字体缺失时 loader 自动走回退链不落豆腐
    const wrapperProps = reactive({
        locale: 'zh',
        theme: 'light',
        useMainThreadDraw: true,
        ...(opts.cadDataBaseUrl ? { baseUrl: opts.cadDataBaseUrl } : {})
    });
    const app = createApp({ render: () => h(viewerMod.MlCadViewer, wrapperProps) });
    if (viewerMod.i18n) app.use(viewerMod.i18n);
    app.use(elementPlus.default ?? elementPlus);
    app.mount(mountEl);

    let dirty = false;
    const editListener = () => { dirty = true; };
    let view = null;
    try {
        const mgr = AcApDocManager?.tryGetInstance?.();
        view = mgr?.curView || null;
        eventBus?.on('session-db-edit-committed', editListener);
        // ② 空画布补默认表数据（layer '0'/线型/Model layout），进去即可画
        if (mgr?.curDocument?.database) {
            mgr.curDocument.database.createDefaultData?.();
            mgr.setActiveLayout?.();
        }
        // 汉字/标注字形前提：预载默认字体 preset（text: simsun→hztxt，symbol: amgdt）。
        // 快照的 PNG 文字=字形矢量 mesh——字体没载完快照里就是豆腐块
        await mgr?.loadFonts?.();
        // ⑤ attedit 命令幂等补注册（库的一次性 flag bug）
        const cmdMgr = mgr?.commandManager;
        if (cmdMgr && viewerMod.AcApAttEditCmd && !cmdMgr.lookupGlobalCmd?.('attedit')) {
            cmdMgr.addCommand('ACAD', 'attedit', 'attedit', new viewerMod.AcApAttEditCmd(), ['eattedit', 'ate']);
        }
    } catch { /* best effort：补丁失败不阻断挂载 */ }

    // viewer 靠 window resize 重量画布；宿主进场动画结束后尺寸才稳定，补一发
    window.dispatchEvent(new Event('resize'));

    const getMgr = () => AcApDocManager?.tryGetInstance?.() ?? null;

    return {
        /** 打开 DXF File 到当前文档（Write 模式 + 打开后适应视图）；返回是否成功 */
        async openFile(file) {
            const mgr = getMgr();
            if (!mgr) throw new Error('CAD 编辑器未就绪');
            const buf = await file.arrayBuffer();
            const ok = await mgr.openDocument(file.name, buf, { mode: 8, openViewMode: 'extents' }); // 8 = AcEdOpenMode.Write
            if (!ok) throw new Error('图纸解析失败（文件损坏或格式不支持，仅支持 DXF）');
            dirty = true; // 打开新图纸即视为有内容，关闭时须写回预览
            // 文字等延迟几何跑完再返回（导出快照的完整性前提，见 AcApOpenDatabaseOptions 文档）
            const v = mgr.curView;
            try {
                await v?.ensureEntitiesConvertedForExport?.();
                await v?.waitUntilIdle?.(15000);
            } catch { /* 等待失败不阻断——快照时还会再兜一次 */ }
            return true;
        },
        getDatabase: () => getMgr()?.curDocument?.database ?? null,
        /** 导出当前文档为 DXF 文本（精度 6）；无文档/失败返回 null */
        dxfOut() {
            try {
                const content = getMgr()?.curDocument?.database?.dxfOut(undefined, 6);
                return typeof content === 'string' && content.length ? content : null;
            } catch {
                return null;
            }
        },
        isDirty: () => dirty,
        clearDirty: () => { dirty = false; },
        /** 白底黑白 PNG 快照（占位区预览，2400px 长边）；失败返回 null——见 cadSnapshot.js */
        snapshotPng: async () => {
            const { snapshotCadPng } = await import('./cadSnapshot.js');
            return snapshotCadPng(simpleMod);
        },
        unmount() {
            removeRoGuard();
            try { eventBus?.off('session-db-edit-committed', editListener); } catch { /* best effort */ }
            // ③ 中和泄漏的 document 键监听
            if (view?._keyHandler) {
                try { view._keyHandler.handleKeyDown = () => false; } catch { /* best effort */ }
                view = null;
            }
            try { app.unmount(); } catch { /* 已卸载 */ }
            if (mountEl) mountEl.innerHTML = ''; // ⑥
        }
    };
}
