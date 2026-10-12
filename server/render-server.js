#!/usr/bin/env node
/**
 * 渲染服务：Tiptap JSON → 定版 PDF（express 薄壳）。
 * 管线本体在 src/server/render.js（宿主后端可直接 import 同一模块），
 * 这里只留 HTTP 入口——demo 与 tests/ 下的冒烟脚本打它。
 *
 * 独立部署（npm bin：paged-doc-render）：
 *   npx paged-doc-render              # 默认 0.0.0.0:8200
 *   PORT=9000 paged-doc-render        # 环境变量
 *   paged-doc-render --port 9000      # 命令行参数
 */
// express/puppeteer 均为 optionalDependency：纯前端用库时不强装。
// bin 入口被用到时才动态 import，缺失给可操作报错
let express;
try {
    express = (await import('express')).default;
} catch {
    console.error('paged-doc-render requires optional dependencies. Run: npm install express puppeteer');
    process.exit(1);
}
import { initRender, renderDocument } from '../src/server/render.js';

const argPort = process.argv.find((a, i) => process.argv[i - 1] === '--port');
const PORT = Number(argPort || process.env.PORT || 8200);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.post('/render', async (req, res) => {
    const { sections, lang, docBaseUrl, siteBaseUrl } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) {
        return res.status(400).json({ error: 'sections required' });
    }

    try {
        // docBaseUrl/siteBaseUrl 可选：文档内部链接相对 href 展开成绝对 URI（透传给 renderDocument）
        const { bytes, pageCounts } = await renderDocument(sections, { lang, docBaseUrl, siteBaseUrl });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('X-Section-Page-Counts', JSON.stringify(pageCounts));
        res.send(bytes);
        console.log(`[render] sections=${sections.length} pages=${pageCounts.join('+')}`);
    } catch (err) {
        console.error('[render] failed:', err);
        res.status(500).json({ error: String(err?.message || err) });
    }
});

await initRender();
app.listen(PORT, HOST, () => console.log(`render-server listening on http://${HOST}:${PORT}`));
