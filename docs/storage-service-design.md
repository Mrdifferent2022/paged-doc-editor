# 配套存储服务设计（未来版本，本期不实现）

> 状态：**设计稿**。当前 `paged-doc-editor` 刻意保持**存储无感知**——doc JSON 的存取完全由宿主应用负责
> （宿主正是靠这一点接入自己的对象存储/数据库体系）。本文档描述可选配套存储服务的接口设计，
> 供未来版本实现；不希望引入存储层的用户永远不需要它。

## 定位

```
paged-doc-editor        编辑器库 + 渲染管线（本仓库，存储无感知）
└─ paged-doc-server（未来，可独立 npm 包或本包 ./server 扩展）
   ├─ REST API：文档 CRUD + 模板管理 + 渲染
   ├─ 存储适配器：MinIO（默认）/ 本地文件系统（兜底）/ S3 兼容（白送）
   └─ 渲染：直接 import 本包 src/server/render.js
```

## 存储适配器接口

```js
// 适配器只需实现这四个方法；MinIO 实现为默认，FileStorage 为离线兜底
interface DocStorage {
  putDoc(key: string, docJson: object, meta?: Record<string, string>): Promise<void>;
  getDoc(key: string): Promise<{ doc: object; meta: Record<string, string> }>;
  listDocs(prefix?: string): Promise<Array<{ key: string; size: number; lastModified: string }>>;
  putArtifact(key: string, bytes: Buffer, contentType: string): Promise<string>; // 返回可访问 URL
}
```

### MinIO 实现要点

- doc JSON 与渲染产物（PDF）分前缀：`docs/*.json`、`artifacts/*-审批版.pdf`
- 渲染产物用对象元数据存源指纹（如 `source-modified`），命中即复用不重复渲染
- presigned URL 供前端直传/直下，服务端不扛流量

### 本地文件系统兜底

- `DATA_DIR/docs/*.json` + `DATA_DIR/artifacts/*.pdf`，零依赖，供 demo/开发用

## REST 端点草图

```
POST   /docs                 新建文档（模板 key + 传参 → fillParams → 存 JSON）
GET    /docs/:key            读文档 JSON
PUT    /docs/:key            保存（指纹比对，未变不写）
GET    /docs?prefix=         列表
POST   /render               复用现有管线：{ sections, lang? } → PDF
POST   /docs/:key/render     读库存 JSON → 渲染 → putArtifact → 返回 PDF URL
```

## 与编辑器现有机制的对接

- **文档内部链接**：编辑器 `docLinkPath` prop（默认 `/open_doc_link/?openFile=`）与渲染侧
  `docBaseUrl + docLinkPath` 展开——配套服务实现 `GET /open_doc_link?openFile=<key>`
  端点（302 到目标文档的审批版 PDF 预签名 URL）即可闭环
- **签章**：宿主调 `applySignatures(sections, signatures)` 后 PUT 回存；服务不介入签名逻辑

## 为什么不内置进编辑器库

硬绑 MinIO 会把用 S3/数据库/已有对象存储的用户挡在门外；存储无感知让编辑器在任何后端体系里都能落地。
配套服务是**可选加速器**，不是必需品。
