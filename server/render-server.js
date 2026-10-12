/**
 * 渲染服务：Tiptap JSON → 定版 PDF（express 薄壳）。
 * 管线本体在 src/server/render.js（宿主后端可直接 import 同一模块），
 * 这里只留 :8200 HTTP 入口——demo 与 tests/ 下的冒烟脚本打它。
 */
import express from 'express';
import { initRender, renderDocument } from '../src/server/render.js';

const PORT = 8200;

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
app.listen(PORT, () => console.log(`render-server listening on http://localhost:${PORT}`));
