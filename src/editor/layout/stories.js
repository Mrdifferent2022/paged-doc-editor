/**
 * 页眉页脚"故事"（stories）选取与占位替换 —— 编辑态/渲染服务/测试三方共用。
 *
 * 奇偶页差异（双面打印惯例）：section.header/footer 是奇数页（兼默认），
 * headerEven/footerEven 是可选偶数页变体，缺省回退奇数版。
 * 页码奇偶按**全局页码**判定（跨节连续编号），与编辑态间隙条、PDF 盖章三处一致。
 */

/** 按全局页码选取某节的页眉/页脚 HTML：{ header, footer, parity } */
export function resolveStories(section, globalPageNo) {
    const even = globalPageNo % 2 === 0;
    return {
        parity: even ? 'even' : 'odd',
        header: (even && section.headerEven) || section.header || '',
        footer: (even && section.footerEven) || section.footer || ''
    };
}

/** 预览/定版占位替换：{page}/{pages} → 具体页码（pageNo 为 null 时显示占位符号，编辑态顶/底条用） */
export function fillHfPreview(html, pageNo = null, totalPages = 0) {
    return (html || '')
        .replaceAll('{page}', pageNo ?? '‹页码›')
        .replaceAll('{pages}', totalPages > 0 ? String(totalPages) : '‹总页数›');
}

/** 页脚占位字段置空（{{key}}/{{sig:role}}/{{sigDate}} → ''）：只隐藏字段本体，标签/灰线/版式正常显示。
 *  原始占位比签名后内容长得多会撑出行、把带撑高，签章后又缩回；置空后行内只剩标签，
 *  行高由 .foot-line 的 6mm 钉死 → 签章前后带高不变、奇偶灰线纵坐标一致。
 *  仅页脚应用（页眉 {{stdNo}}/{{stdName}} 占位短不超行、模板维护要看到标题栏 → 页眉不置空）：
 *  显示三处（sheet 预览条/页间隙条/打印模板）同源调用，编辑态 RO 与打印测量前置量同一 HTML，几何一致。
 *  （用户 2026-08-27：隐藏占位字段而非整带；奇数页页脚同样正常显示） */
export const blankPendingHfFields = (html) => (html || '').replace(/\{\{[^}]*\}\}/g, '');
