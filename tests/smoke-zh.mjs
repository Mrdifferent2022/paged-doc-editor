/** 中文模板冒烟：模板 JSON + 传参 + 模拟签章 → /render → 保存 PDF
 *  前置：npm run render-server（:8200）已启动
 *  ① 生成原始模板 JSON（{{占位}} 保留，宿主可直接存为模板）
 *  ② fillParams + 签章 → /render → smoke.pdf */
import { writeFile, mkdir } from 'node:fs/promises';
import { buildTemplateSections, fillParams, applySignatures } from '../src/editor/templates/standardTemplate.js';

const out = new URL('./out/', import.meta.url);
await mkdir(out, { recursive: true });

// ① 原始模板 JSON（模板源码改动后须再生）
const raw = buildTemplateSections();
await writeFile(new URL('./tiptap-template.json', out), JSON.stringify({ version: 1, sections: raw }, null, 2));
console.log('template JSON saved, sections =', raw.length);

const params = {
    stdName: '工艺标准文件',
    stdNo: 'DOC-2026-0001',
    projectName: '示例项目',
    lineNo: 'L3',
    partName: '示例零件',
    preparedBy: '张三',
    preparedByEmail: 'zhangsan@example.com'
};

// 模拟签章后再渲染，验证奇数页页脚签章行（日期=最后审批日期）与偶数页页脚联系方式
// signedBy 随文档语言：中文文档签汉字（KaiTi SVG），英文文档才签拼音
const sections = applySignatures(fillParams(buildTemplateSections(), params), {
    submitter: { signedBy: '张三', signedAt: '2026-08-20' },
    checker: { signedBy: '李四', signedAt: '2026-08-21' },
    auditor: { signedBy: '王五', signedAt: '2026-08-22' },
    approver: { signedBy: '赵六', signedAt: '2026-08-24' }
});

const resp = await fetch('http://localhost:8200/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections })
});

if (!resp.ok) {
    console.error('render failed:', resp.status, await resp.text());
    process.exit(1);
}
console.log('page counts per section:', resp.headers.get('X-Section-Page-Counts'));
const buf = Buffer.from(await resp.arrayBuffer());
await writeFile(new URL('./smoke.pdf', out), buf);
console.log('saved smoke.pdf, bytes =', buf.length);
