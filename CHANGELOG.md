# Changelog

## 0.1.0 (2026-10-10)

首个开源版本。

- 多节分页文档编辑器（Tiptap v3）：每节独立纸张（A4/A3）、方向、页边距、页眉页脚
- 所见即所得软分页：编辑态与导出 PDF 分页逐页一致（同一页面几何引擎）
- 页眉/页脚：奇偶页变体、章节行、版本号 + 二维码、可锁定（由传参/签章流程驱动）
- 签章流程：`{{sig:role}}` 占位 → 逐级签章回填（中文 KaiTi / 英文 Times 斜体 SVG 签名），
  `{{sigDate}}` 取最后审批日期；`resetSignatures` 支持变更重签
- 模板参数化：`fillParams` 传参填充、跨表/跨节字段联动（bindKey）、默认值回填
- 中英文双模板：单一 LABELS 事实源双语生成，英文文档 Times 优先字体栈
- 服务端定版渲染：Tiptap JSON → PDF（puppeteer + pdf-lib），全局连续页码盖章、
  奇偶交错合并、文档内部链接展开为绝对 URI
- CAD 图纸插入（DXF，基于 mlightcad）：白底黑白预览快照、弹窗编辑写回
- 表格：跨页劈行、衬垫行、格底色、浮动手柄等加固

字体说明：`src/server/assets/notoserif-digits.ttf` 为 Noto Serif（SIL OFL 1.1）数字子集，
仅含 0-9，用于 PDF 页码盖章。
