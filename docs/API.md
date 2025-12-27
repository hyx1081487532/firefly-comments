# Firefly Comments — API 文档

以下为主要 HTTP API 接口说明（示例基于部署域名 https://your-worker.workers.dev）。

## 公共接口

### GET /api/comments
- 描述：获取指定文章已审核通过的评论
- 参数：
  - `url`（必需）文章 URL 或标识
  - `limit`（可选）最大返回数量
- 示例：

```bash
curl "https://your-worker.workers.dev/api/comments?url=https://example.com/post/1&limit=20"
```

返回：JSON 数组

### POST /api/comments
- 描述：提交新评论（进入 `pending` 状态，需要管理员审核）
- 请求头：`Content-Type: application/json`
- 请求体：
  - `url`（string，必需）
  - `name`（string，可选）
  - `email`（string，可选，格式校验）
  - `content`（string，必需）

- 示例：

```bash
curl -X POST https://your-worker.workers.dev/api/comments \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/post/1","name":"小明","content":"很棒的文章！"}'
```

返回：{ ok: true, id }


## 管理接口（需要管理员密码）
> 管理接口可通过 HTTP Header `x-admin-password` 传入密码，或在导出场景下通过查询参数 `?x-admin-password=` 传入。

### GET /api/admin/comments
- 描述：列出所有评论，可通过 `?status=pending|approved|rejected` 筛选
- 示例：

```bash
curl -H "x-admin-password: YOUR_PASSWORD" "https://your-worker.workers.dev/api/admin/comments?status=pending"
```

### POST /api/admin/comments/:id/:action
- 描述：对单条评论执行动作，`:action` 为 `approve`、`reject` 或 `edit`
- `edit` 的请求体（JSON）可以包含 `content` 和 `name` 字段
- 示例：审核通过

```bash
curl -X POST -H "x-admin-password: YOUR_PASSWORD" "https://your-worker.workers.dev/api/admin/comments/123/approve"
```

编辑评论示例：

```bash
curl -X POST -H "x-admin-password: YOUR_PASSWORD" -H "Content-Type: application/json" \
  -d '{"content":"已编辑的内容"}' \
  "https://your-worker.workers.dev/api/admin/comments/123/edit"
```

### DELETE /api/admin/comments/:id
- 描述：删除评论
- 示例：

```bash
curl -X DELETE -H "x-admin-password: YOUR_PASSWORD" "https://your-worker.workers.dev/api/admin/comments/123"
```

管理界面（`/admin`）现在支持在页面上直接进行 **通过/拒绝/编辑/删除** 操作，并支持导出 CSV（通过 Header 或查询参数传入 `x-admin-password`）。
### GET /api/admin/comments/export
- 描述：导出所有评论 CSV（支持 `?x-admin-password=` 或 Header 方式认证）

```bash
curl -H "x-admin-password: YOUR_PASSWORD" "https://your-worker.workers.dev/api/admin/comments/export" -o comments.csv
```

---

如需示例测试脚本，请查看 `tests/test_api.js`（在本仓库中）。