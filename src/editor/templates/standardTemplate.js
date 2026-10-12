/**
 * PoC 模板包：模拟 standard 的一种版式 —— 模板包范式（新文档类型照抄本结构即可）。
 * - Section 1：A4 纵向（封面信息 + 正文 + 参数表 + 签名区）
 * - Section 2：A3 横向（工艺大表，部分字段与 Section 1 联动）
 *
 * 模板包 = meta（传参定义）+ pageSpec（默认纸张）+ stories（页眉页脚 × 奇偶 HTML）+ 内容构建/填充函数。
 * 页眉页脚存"内部内容"（不含 .hf 包装 div）：包装由容器提供——编辑态 .sheet-hf/.vp-gap 条、
 * 打印态 render-server 模板帧——这样富文本子编辑器 round-trip 不会丢包装、样式上下文三处一致。
 * field 节点带 key（新建传参填充用）和 bindKey（跨表/跨节联动用）。
 */
import { mmToPx, paperSizeMm } from '../layout/pageLayout.js';
import QRCode from 'qrcode';

export { mmToPx, paperSizeMm };

/**
 * 同步生成 QR SVG dataURL：QRCode.create 同步出点阵 → 单 path SVG（不走路由库异步 renderer）。
 * 页眉二维码用：story 里 <img data-qr-key="stdNo"> 占位，fillParams 按参数值重新生成 src。
 */
const qrSvgDataUrl = (text) => {
    const m = QRCode.create(String(text), { errorCorrectionLevel: 'M' }).modules;
    let d = '';
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.size} ${m.size}"><path d="${d}" fill="#000"/></svg>`);
};

// 示例 logo：圆角方块 + 三条横线（文档意象的通用占位标，宿主可换成自己的）。
// 必须用 <img data-inline>（InlineImage 行内 atom）承载——
// 内联 <svg> 元素 PM 不认识，页眉子编辑器 round-trip 会直接剥掉（实测 logo 进编辑态消失）
// dataURL 里的 SVG 不继承页面 CSS，原 currentColor 落黑色——显式 #444 对齐 .hf 文字色保持原观感
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="14" y="10" width="72" height="80" rx="12" fill="none" stroke="#444" stroke-width="8"/><rect x="28" y="30" width="44" height="8" rx="4" fill="#444"/><rect x="28" y="48" width="44" height="8" rx="4" fill="#444"/><rect x="28" y="66" width="30" height="8" rx="4" fill="#444"/></svg>`;
const LOGO_SRC = 'data:image/svg+xml;base64,' + btoa(LOGO_SVG);

export const templateMeta = {
    name: '工艺标准文件（示例模板）',
    // 新建时传参：大标准名称/编号进页眉中列第一行（每页重复）；本文件是大标准的一个章节——
    // 章节号/章节名称进页眉中列第二行（2026-09-07 从正文 H1 上移）；编制人邮箱进偶数页页脚，另附正文字段
    params: [
        { key: 'stdName', label: '标准名称' },
        { key: 'stdNo', label: '标准编号' },
        // verNo：页眉版本格 V001（V+file_version_index 三位补零，宿主 composeVerNo 组装）——
        // 状态文字（有效/废止）不进页眉：废止由 worker 用 pdf-lib 在旧版审批 PDF 上盖水印（2026-09-04 用户拍板）
        { key: 'verNo', label: '版本号' },
        { key: 'chapNo', label: '章节号' },
        { key: 'chapName', label: '章节名称' },
        { key: 'projectName', label: '项目名称' },
        { key: 'lineNo', label: '生产线号' },
        { key: 'partName', label: '零件名称' },
        { key: 'preparedBy', label: '编制人' },
        // default：未传参/传空串时 fillParams 回填默认邮箱（默认邮箱占位，传参替换）
        { key: 'preparedByEmail', label: '编制人邮箱', default: 'docs@example.com' }
    ]
};

/** 默认纸张规格（节级仍可覆盖，混排靠工具栏插节） */
export const pageSpec = { size: 'A4', orientation: 'portrait' };

/**
 * 双语字典：模板所有面向读者的文案集中于此——单一事实源。
 * 中/英两份模板 JSON 由同一脚本按 lang 双出（物理两份、源一处），改版式只改本文件再双生。
 * lang='zh' 是全局默认：未传 lang 的调用方行为零变化。
 * 偶数页脚一行装下是硬约束（email+地址+归属 ≈100 字符 @9pt ≈435pt < 版心 482pt）——译文务必紧凑。
 */
export const LABELS = {
    zh: {
        company: '示例制造有限公司',
        deptDoc: '技术规划部 技术标准',
        pageFmt: '第{page}页 共{pages}页',
        qrAlt: '二维码',
        sigSubmitter: '编制：',
        sigChecker: '校对：',
        sigAuditor: '审核：',
        sigApprover: '批准：',
        sigDateLabel: '日期：',
        address: '示例市示范园区示例路8号',
        ownership: '本标准归示例制造技术规划部所有',
        pending: '待签署',
        chapNoLabel: '章节号',
        chapNameLabel: '章节名称',
        // ---- 正文骨架（buildTemplateSections 用；field 的 label 仅空值占位显示） ----
        projectLabel: '项目名称：',
        lineLabel: '    生产线：',
        partLabel: '零件名称：',
        scopeH2: '1 适用范围',
        scopePre: '本文件规定了 ',
        scopeMid: ' 在 ',
        scopePost: ' 的工艺要求、检验方法与记录要求。',
        infoH2: '2 基本信息',
        thItem: '项目',
        thContent: '内容',
        thNote: '备注',
        deptCell: '编制部门',
        preparedByCell: '编制人',
        sigLinkNote: '与页脚签名联动',
        effectiveDateCell: '生效日期',
        processH2: '3 工艺要求',
        editorHint: '正文编辑区：支持加粗、斜体、标题、表格、分页符等，工具栏见顶部。',
        sigMovedNote: '签名区已移至页脚签名条，每页重复显示；签章由审批 worker 回填。',
        thNo: '序号',
        thOp: '工序',
        thDevice: '设备',
        thProject: '项目名称',
        thLine: '生产线',
        thPart: '零件',
        thParamA: '参数A',
        thParamB: '参数B',
        thParamC: '参数C',
        thInspect: '检验',
        opPrefix: '工序-',
        inspectFull: '全检',
        inspectSample: '抽检',
        bigTableH2: '4 工艺参数表（A3 横向）',
        bigTableNote: '本表「项目名称 / 生产线 / 零件」列与封面信息联动（bindKey 相同）。',
        projectField: '项目名称',
        lineField: '生产线号',
        partField: '零件名称',
        deptField: '部门',
        preparedByField: '编制人',
        dateField: '日期',
        deviceField: '设备'
    },
    en: {
        company: 'Example Manufacturing Co., Ltd.',
        deptDoc: 'Technical Planning Standard',
        pageFmt: 'Page {page} of {pages}',
        qrAlt: 'QR',
        sigSubmitter: 'Prepared: ',
        sigChecker: 'Checked: ',
        sigAuditor: 'Audited: ',
        sigApprover: 'Approved: ',
        sigDateLabel: 'Date: ',
        address: 'No. 8 Example Road, Demo District',
        // 归属声明用 Copyright（不用 Property）；与地址之间加 '. ' 分隔（见 footerEven）
        ownership: 'Copyright © Example Corp',
        pending: 'Pending',
        chapNoLabel: 'Chapter No.',
        chapNameLabel: 'Chapter Title',
        // ---- Body skeleton (buildTemplateSections; field labels only show as empty placeholders) ----
        projectLabel: 'Project: ',
        lineLabel: '    Line: ',
        partLabel: 'Part: ',
        scopeH2: '1 Scope',
        scopePre: 'This document specifies the process, inspection and record requirements for ',
        scopeMid: ' on ',
        scopePost: '.',
        infoH2: '2 Basic Information',
        thItem: 'Item',
        thContent: 'Content',
        thNote: 'Remarks',
        deptCell: 'Department',
        preparedByCell: 'Prepared by',
        sigLinkNote: 'Linked with footer signature',
        effectiveDateCell: 'Effective Date',
        processH2: '3 Process Requirements',
        editorHint: 'Body editing area: bold, italic, headings, tables and page breaks are supported; see the toolbar above.',
        sigMovedNote: 'The signature area has moved to the footer bar, repeated on every page; signatures are filled by the approval worker.',
        thNo: 'No.',
        thOp: 'Operation',
        thDevice: 'Equipment',
        thProject: 'Project',
        thLine: 'Line',
        thPart: 'Part',
        thParamA: 'Param A',
        thParamB: 'Param B',
        thParamC: 'Param C',
        thInspect: 'Inspection',
        opPrefix: 'OP-',
        inspectFull: 'Full',
        inspectSample: 'Sample',
        bigTableH2: '4 Process Parameter Table (A3 Landscape)',
        bigTableNote: 'The Project / Line / Part columns are linked with the cover info (same bindKey).',
        projectField: 'Project Name',
        lineField: 'Line No.',
        partField: 'Part Name',
        deptField: 'Department',
        preparedByField: 'Prepared by',
        dateField: 'Date',
        deviceField: 'Equipment'
    }
};
/** 取词典：未知 lang 回退 zh */
export const labelsOf = (lang) => LABELS[lang] || LABELS.zh;

/**
 * 页眉页脚 stories（奇偶变体；偶数变体缺省时全文档回退奇数版）。
 * 页眉 = 公司标题栏（3列×2行网格）：
 *   行1：公司名 | {{stdNo}} {{stdName}}（小字 9pt，一行） | 第 {page} 页 共 {pages} 页
 *   行2：部门·文档类型 | {{chapNo}} {{chapName}}（章节号+章节名称） | {{verNo}}（V001）+ 二维码同格
 * 三列内容全居中；中列最宽（zh 52%）——长标准名称/章节名不折行。
 * **页眉无偶数变体**（奇偶同版走 resolveStories 缺省回退，而不是复制一份——复制出来的两份会被单独编辑成不一致，
 * "改了第1页第2页不变"）；版本号走 {{verNo}} 传参（宿主 composeVerNo 由版本序号组装）；
 * 状态文字（有效/废止）不进页眉——废止可由宿主用 pdf-lib 在旧版审批 PDF 上盖水印。
 * 页脚 = 奇偶不同版（双面惯例）：奇数页签章行（无表格，段落排版）、偶数页编制人联系方式+归属声明。
 * 灰分隔线 = 段落 border-top（画在内容里，各页都在页边距内与正文同宽——画在 .hf 带元素上会被间隙条通栏绘制拉纸边）。
 * 占位：{{key}} 传参、{page}/{pages} 页码、{{sig:role}} 签名、{{sigDate}} 最后审批日期。
 */
export const stories = {
    // 对齐用 hf-c/hf-r 类不用内联 style：子编辑器 round-trip 只保 class（classKeep 扩展），内联 style 会丢
    headerOdd: (lang = 'zh') => {
        const L = labelsOf(lang);
        // stdNo/stdName 与 chapNo/chapName 内部分隔：中文用全角空格；英文用半角空格——拉丁排版规范且省 ~10px
        // （全角空格在 Times 下无字形落 SimSun ≈1em 宽，标题格本就紧张，用户 2026-09-04 英文标题导出折行）
        const noSep = lang === 'en' ? ' ' : '　';
        // 二维码与版本号同格（2026-09-07 用户：QR 贴 V001 不分割，页眉收 3 列让宽给中列防长题折行）
        return `<table class="hf-title"><tr>
            <td class="hf-company hf-c"><img class="hf-logo" data-inline src="${LOGO_SRC}" alt="logo"/>${L.company}</td>
            <td class="hf-doc hf-c">{{stdNo}}${noSep}{{stdName}}</td>
            <td class="hf-page hf-c">${L.pageFmt}</td>
        </tr><tr>
            <td class="hf-dept hf-c">${L.deptDoc}</td>
            <td class="hf-chap hf-c">{{chapNo}}${noSep}{{chapName}}</td>
            <td class="hf-ver hf-c">{{verNo}} <img class="hf-qr" src="${qrSvgDataUrl('template')}" data-qr-key="stdName" alt="${L.qrAlt}"/></td>
        </tr></table>`;
    },
    // 页脚奇数页：签章行（签章由 worker 回填 {{sig:role}} 占位；{{sigDate}} = 最后审批日期，applySignatures 取各角色 signedAt 最大者）。
    // 单个全角空格分隔：4 张签名图 + 双空格在 A4 版心 482pt 放不下会换行（带撑高、灰线位置就与偶数页不齐）。
    // 每个占位包定宽槽（.sig-slot/.date-slot，槽宽≥内容宽：签名图 90:28 宽高比 × 5.5mm 高 = 17.7mm 恒定、
    // 日期 ≈16mm）——置空（未签章）时槽撑住宽度，签章回填后内容落进槽内，标签位置两态不动（用户 2026-08-28）
    footerOdd: (lang = 'zh') => {
        const L = labelsOf(lang);
        const sep = lang === 'en' ? '  ' : '　'; // 英文分隔用两个半角空格（全角空格在拉丁字体下太宽）
        return `<p class="foot-line hf-c">${L.sigSubmitter}<span class="sig-slot">{{sig:submitter}}</span>${sep}${L.sigChecker}<span class="sig-slot">{{sig:checker}}</span>${sep}${L.sigAuditor}<span class="sig-slot">{{sig:auditor}}</span>${sep}${L.sigApprover}<span class="sig-slot">{{sig:approver}}</span>${sep}${L.sigDateLabel}<span class="date-slot">{{sigDate}}</span></p>`;
    },
    // 页脚偶数页：编制人邮箱（传参 preparedByEmail，定宽槽同奇数页理由）+ 地址 + 归属声明；
    // 无"邮箱：/地址："标签——内容本身可辨识（用户 2026-08-28："直接写邮箱、地址内容"）
    footerEven: (lang = 'zh') => {
        const L = labelsOf(lang);
        const sep = lang === 'en' ? '  ' : '　';
        // 英文版地址与归属声明都是拉丁词串、两空格分不开——地址后加 '. ' 句点显式分隔
        // （用户 2026-09-04：要右下角的 . 点，不要中点 ·）
        const ownSep = lang === 'en' ? '. ' : sep;
        return `<p class="foot-line hf-c"><span class="email-slot">{{preparedByEmail}}</span>${sep}${L.address}${ownSep}${L.ownership}</p>`;
    }
};

let sectionSeq = 0;
/** 新插入的空白节（工具栏「插入节」用）：同款页眉页脚占位 + 一段空正文；页眉页脚默认锁定 */
export function buildSection({ pageSize = pageSpec.size, orientation = pageSpec.orientation, lang = 'zh' } = {}) {
    return {
        id: `sec-${Date.now().toString(36)}-${sectionSeq++}`,
        pageSize,
        orientation,
        header: stories.headerOdd(lang),
        // 页眉无偶数变体（奇偶同版走缺省回退）；页脚有偶数变体（奇偶不同版）
        footer: stories.footerOdd(lang),
        footerEven: stories.footerEven(lang),
        headerEditable: false, // 页眉页脚是否可在编辑态直接改（false=锁定，由传参/签章流程驱动）
        footerEditable: false,
        content: [{ type: 'paragraph' }]
    };
}

export function buildTemplateSections(lang = 'zh') {
    const L = labelsOf(lang);
    const field = (key, label, bindKey = null, value = '', locked = false) => ({
        type: 'field',
        attrs: { key, label, value, bindKey, locked }
    });
    const text = (t, marks) => ({ type: 'text', text: t, ...(marks ? { marks } : []) });
    const h2 = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] });
    const para = (...content) => {
        const valid = content.filter((c) => !(c.type === 'text' && c.text === ''));
        return valid.length ? { type: 'paragraph', content: valid } : { type: 'paragraph' };
    };
    const cell = (...content) => ({ type: 'tableCell', content: [para(...content)] });
    const header = (...content) => ({ type: 'tableHeader', content: [para(...content)] });
    const row = (...cells) => ({ type: 'tableRow', content: cells });

    // 页眉页脚统一由 stories 生成（插入新节复用同一模板；页眉奇偶同版=无偶数变体，页脚奇偶不同版）
    const hf = () => ({
        header: stories.headerOdd(lang),
        footer: stories.footerOdd(lang),
        footerEven: stories.footerEven(lang)
    });

    const section1 = {
        id: 'sec-cover',
        pageSize: 'A4',
        orientation: 'portrait',
        bodyPadMm: { top: 2 }, // 页眉标题栏下不预留大空白（默认 6mm 太大；页眉带自带 2mm 下 padding）
        ...hf(),
        headerEditable: false, // 页眉页脚固定不编辑（用户 2026-08-25 拍板：模板版式由模板维护，文档实例只经传参/签章驱动）
        footerEditable: false,
        content: [
            // 2026-09-07 页眉改版：章节号/章节名称上移页眉中列第二行（{{chapNo}} {{chapName}} 传参），
            // 正文顶部不再放章节 H1（存量文档的 H1 保留不动——用户拍板存量不迁移）
            para(text(L.projectLabel), field('projectName', L.projectField, 'projectName'), text(L.lineLabel), field('lineNo', L.lineField, 'lineNo')),
            para(text(L.partLabel), field('partName', L.partField, 'partName')),
            { type: 'horizontalRule' },
            h2(L.scopeH2),
            para(text(L.scopePre), field('partName', L.partField, 'partName'), text(L.scopeMid), field('lineNo', L.lineField, 'lineNo'), text(L.scopePost)),
            h2(L.infoH2),
            {
                type: 'table',
                content: [
                    row(header(text(L.thItem)), header(text(L.thContent)), header(text(L.thNote))),
                    row(cell(text(L.deptCell)), cell(field('dept', L.deptField)), cell(text(''))),
                    row(cell(text(L.preparedByCell)), cell(field('preparedBy', L.preparedByField, 'preparedBy')), cell(text(L.sigLinkNote))),
                    row(cell(text(L.effectiveDateCell)), cell(field('effectiveDate', L.dateField)), cell(text('')))
                ]
            },
            { type: 'pageBreak' },
            h2(L.processH2),
            para(text(L.editorHint)),
            para(text(L.sigMovedNote))
        ]
    };

    const bigTableRows = [];
    bigTableRows.push(
        row(
            header(text(L.thNo)), header(text(L.thOp)), header(text(L.thDevice)),
            header(text(L.thProject)), header(text(L.thLine)), header(text(L.thPart)),
            header(text(L.thParamA)), header(text(L.thParamB)), header(text(L.thParamC)), header(text(L.thInspect))
        )
    );
    // 12 行：保证整节（标题+说明+表）在一页 A3 横向内容高以内，演示干净的一节一页；
    // 超高表格的跨页虚线指示由无头脚本动态灌行验证，不占默认演示
    for (let i = 1; i <= 12; i++) {
        bigTableRows.push(
            row(
                cell(text(String(i))),
                cell(text(`${L.opPrefix}${i}`)),
                cell(field(`device_${i}`, L.deviceField)),
                cell(field(`pname_${i}`, L.projectField, 'projectName')),
                cell(field(`pline_${i}`, L.thLine, 'lineNo')),
                cell(field(`ppart_${i}`, L.thPart, 'partName')),
                cell(field(`pa_${i}`, 'A')),
                cell(field(`pb_${i}`, 'B')),
                cell(field(`pc_${i}`, 'C')),
                cell(text(i % 3 === 0 ? L.inspectFull : L.inspectSample))
            )
        );
    }

    // A3 横向节：默认不存在，经工具栏「插入 A3 横向节」按需加入（PoC 中预置用于验证混排渲染）
    const section2 = {
        id: 'sec-bigtable',
        pageSize: 'A3',
        orientation: 'landscape',
        bodyPadMm: { top: 2 }, // 与 section1 一致：页眉标题栏下不留大空白
        ...hf(),
        headerEditable: false, // 与 section1 一致：页眉页脚锁定（可编辑能力保留在引擎层，按节开关）
        footerEditable: false,
        content: [
            h2(L.bigTableH2),
            para(text(L.bigTableNote)),
            { type: 'table', content: bigTableRows }
        ]
    };

    return [section1, section2];
}

/**
 * 空白模板（2026-08-28 用户要求）：A4 纵向两页、仅页眉页脚、正文空白、无 A3 节。
 * 两页是为了奇偶页脚变体都出场：页1 奇数页脚（签章行）、页2 偶数页脚（邮箱/地址/归属）。
 * 宿主把本函数原始 JSON（{{占位}} 保留）存为独立模板节点即可。
 */
export function buildBlankSections(lang = 'zh') {
    return [
        {
            id: 'sec-blank',
            pageSize: 'A4',
            orientation: 'portrait',
            bodyPadMm: { top: 2 }, // 与主模板一致：页眉标题栏下不留大空白
            header: stories.headerOdd(lang),
            footer: stories.footerOdd(lang),
            footerEven: stories.footerEven(lang),
            headerEditable: false, // 页眉页脚锁定，只经传参/签章驱动（与主模板同）
            footerEditable: false,
            content: [{ type: 'paragraph' }, { type: 'pageBreak' }, { type: 'paragraph' }]
        }
    ];
}

/** 页眉版本号：'V' + file_version_index 三位补零（用户 2026-09-04：V001 的 001=版本序号，不带 A/B 字母） */
export const composeVerNo = (versionIndex) => `V${String(versionIndex ?? 1).padStart(3, '0')}`;

/** 重写所有 section 页眉（奇偶变体）版本格里的版本文字——占位符 {{verNo}} 与存量字面量 'V001　有效' 都命中。
 *  worker 签章/废止路径用：存储 JSON 里的格子可能已被 fillParams 填掉（无占位符），直接按 class 定位重写。
 *  2026-09-07 页眉改版后版本格同格内嵌二维码 <img>——只替换开标签后的纯文本前缀，<img> 原样保留。
 *  页脚不动（签名在页脚）。返回深拷贝，入参不变。 */
export function setHeaderVerNo(sections, verNo) {
    const rx = /(<td class="hf-ver[^"]*">)[^<]*/g;
    const cloned = JSON.parse(JSON.stringify(sections));
    cloned.forEach((s) => {
        if (s.header) s.header = s.header.replace(rx, `$1${verNo} `);
        if (s.headerEven) s.headerEven = s.headerEven.replace(rx, `$1${verNo} `);
    });
    return cloned;
}

/** 传参填充：正文 field（key 优先、bindKey 兜底）+ 页眉页脚（奇偶全部变体）的 {{key}} 占位。
 *  opts.applyDefaults=false：宿主打开时重同步用——只填显式传入的 key，
 *  不把 templateMeta 默认值（如公共邮箱）刷进已有字段值。 */export function fillParams(sections, params, { applyDefaults = true } = {}) {
    // 参数默认值（templateMeta.params 里带 default 的 key）：未传或传空串时回填——
    // 新建表单把每个参数初始化成 ''，空串必须视为"未提供"，否则默认值永远被 '' 盖掉（2026-08-28 踩坑）
    const p = { ...params };
    if (applyDefaults) {
        for (const meta of templateMeta.params) {
            if (meta.default !== undefined && (p[meta.key] === undefined || p[meta.key] === '')) p[meta.key] = meta.default;
        }
    }
    // 参数值归一化（2026-09-07 兜底）：对象/数组值直接剔除（String(obj) 会把 [object Object] 烙进文档——
    // 宿主曾在 2 层节点下建文件时把模板对象当 stdName 传入）；数字/布尔等原始值统一转字符串
    for (const k of Object.keys(p)) {
        const v = p[k];
        if (v !== null && typeof v === 'object') delete p[k];
        else if (v !== undefined) p[k] = String(v);
    }
    const fillText = (t) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (p[k] !== undefined ? p[k] : m));
    const walk = (nodes) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (node.type === 'field') {
                const { key, bindKey } = node.attrs || {};
                if (p[key] !== undefined) {
                    node.attrs.value = p[key];
                } else if (bindKey && p[bindKey] !== undefined) {
                    node.attrs.value = p[bindKey];
                }
            } else if (node.type === 'text' && typeof node.text === 'string') {
                node.text = fillText(node.text); // 标题等正文文本里的 {{key}} 占位
            }
            walk(node.content);
        }
    };
    // 页眉二维码：<img data-qr-key="stdName"> 按解析后的参数值重新生成 src；参数缺失/空串 → 整图移除（格留空）。
    // key=stdName：宿主新建流 fillParams(..., {stdName:文件名, ...}) —— 二维码即"新建时按文件名生成"（2026-08-28 用户拍板）
    const fillQr = (html) =>
        (html || '').replace(/<img\b[^>]*\bdata-qr-key="(\w+)"[^>]*\/?>/g, (tag, k) => {
            const v = p[k];
            if (v === undefined || v === '') return '';
            return tag.replace(/src="[^"]*"/, `src="${qrSvgDataUrl(v)}"`);
        });
    const fillHf = (html) => fillQr((html || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (p[k] !== undefined ? p[k] : m)));

    const cloned = JSON.parse(JSON.stringify(sections));
    cloned.forEach((s) => {
        walk(s.content);
        s.header = fillHf(s.header);
        s.headerEven = s.headerEven !== undefined ? fillHf(s.headerEven) : undefined;
        s.footer = fillHf(s.footer);
        s.footerEven = s.footerEven !== undefined ? fillHf(s.footerEven) : undefined;
    });
    return cloned;
}

/**
 * 签章：把页脚（奇偶全部变体）的 {{sig:role}} 占位替换为签名
 * （一律按 signedBy 生成 SVG，不用手写 PNG 图片——worker 端因此不需要签名图目录；
 * 签名文字随文档语言（用户 2026-09-02 二轮定）：中文文档 signedBy=汉字 → KaiTi 正楷 SVG；
 * 英文文档 signedBy=拼音 → Times 斜体 SVG（手写体观感）；
 * {{sigDate}} = 最后审批日期（各角色 signedAt 取最大，
 * ISO 日期字符串字典序=时序；全无 → '—'）。返回新的 sections（页脚 HTML 已更新）。
 *
 * opts.keepPending（worker 逐级签章用）：本次未签的角色保留 {{sig:role}} 占位（供后续角色续签），
 * 否则（一次性渲染/导出）未签角色落"待签署"。日期写成 <span class="sig-date"> 包裹——
 * 逐级签章时每级重调本函数，旧 span 被覆盖为最新日期（审批顺序=时序，最新即 max）。
 */
export function applySignatures(sections, signatures, { keepPending = false, lang = 'zh' } = {}) {
    const sigDate =
        Object.values(signatures || {})
            .map((s) => s?.signedAt)
            .filter(Boolean)
            .sort()
            .pop() || '—';
    // 签名图 HTML 生成（placeholder 替换与既有图刷新共用，保证两路径产物逐字节一致）：
    // 字号 16.2：SVG 高 28 → 渲染高 5.5mm（缩放 0.557）→ 有效 ≈9pt，与"编制："等标签同号
    // （15 时实测 8.2pt 比标签小一截，用户 2026-08-28 投诉签章与标签字号不一）；
    // 字体随文档语言（2026-09-02 用户定）：zh=汉字 → KaiTi 正楷（CJK 无斜体，不 faux-italic）；
    // en=拼音 → Times 斜体（手写体观感），KaiTi 兜底残留 CJK
    const sigImg = (role, sig) => {
        const font =
            lang === 'en'
                ? `font-style="italic" font-family="'Times New Roman',KaiTi,cursive"`
                : `font-family="KaiTi,'楷体',cursive"`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="28">
                <text x="4" y="21" font-size="16.2" ${font} fill="#1d4ed8">${sig.signedBy}</text>
            </svg>`;
        return `<img class="sig-img" src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}" alt="${role}"/>`;
    };
    const fillSigs = (html) => {
        let out = html || '';
        // 驳回→重新提交场景：该角色 {{sig:role}} 占位已被上次签章换成 img，
        // 重签（可能换了提交人）须刷新既有签名图，否则旧签名残留（2026-08-31 审查发现）。
        // src 为 base64 dataURL（字母表无 > 和 "），[^>]* 匹配安全。
        for (const [role, sig] of Object.entries(signatures || {})) {
            if (!sig) continue;
            const esc = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            out = out.replace(new RegExp(`<img class="sig-img"[^>]*alt="${esc}"[^>]*/>`, 'g'), sigImg(role, sig));
        }
        return out
            .replace(/\{\{sig:(\w+)\}\}/g, (m, role) => {
                const sig = signatures[role];
                if (!sig) return keepPending ? m : labelsOf(lang).pending;
                return sigImg(role, sig);
            })
            // 先覆盖旧 span（逐级签章更新日期），再替换首签的 {{sigDate}} 占位
            .replace(/<span class="sig-date">[^<]*<\/span>/g, `<span class="sig-date">${sigDate}</span>`)
            .replaceAll('{{sigDate}}', `<span class="sig-date">${sigDate}</span>`);
    };
    const cloned = JSON.parse(JSON.stringify(sections));
    cloned.forEach((s) => {
        s.footer = fillSigs(s.footer);
        s.footerEven = s.footerEven !== undefined ? fillSigs(s.footerEven) : undefined;
    });
    return cloned;
}

/**
 * 签章还原（变更/revise 用）：applySignatures 把签名写进可编辑母版，revise 复制出的新草稿
 * 会带着上一轮签名图与日期。本函数把页脚还原到待签状态：
 *   <img class="sig-img" alt="role"> → {{sig:role}} 占位；<span class="sig-date"> → {{sigDate}} 占位。
 * 对从未签章的文档是 no-op（模板新建流同走复制端点，安全）。与 applySignatures 互逆。
 */
export function resetSignatures(sections) {
    const reset = (html) =>
        (html || '')
            .replace(/<img class="sig-img"[^>]*alt="(\w+)"[^>]*\/>/g, '{{sig:$1}}')
            .replace(/<span class="sig-date">[^<]*<\/span>/g, '{{sigDate}}');
    const cloned = JSON.parse(JSON.stringify(sections));
    cloned.forEach((s) => {
        s.footer = reset(s.footer);
        s.footerEven = s.footerEven !== undefined ? reset(s.footerEven) : undefined;
    });
    return cloned;
}
