# Firefly Comments

轻量级评论系统，为你的博客提供可审核的评论功能，使用 Cloudflare Workers + D1，设计为部署到 Cloudflare。

## 特性

- 评论提交后进入“待审核”状态，需管理员人工审核后公开
- 管理后台：查看、审核、删除评论（通过管理员密码认证）
- 存储：Cloudflare D1
- 嵌入脚本：可直接在 Astro 或其他静态站点中插入
- 基本防滥用：支持 Cloudflare Turnstile（可选）

## 快速开始

1. 安装工具：Node.js (LTS), pnpm (或 npm), wrangler

```bash
# 推荐使用 pnpm
pnpm install
npm install -g wrangler
```

2. 在 Cloudflare 上创建 D1 数据库（例如命名为 `firefly_comments`）并记录数据库名。

3. 设置 Wrangler 配置：在 `wrangler.toml` 中填写 `name` 与绑定信息（示例已存在）。

4. 设置管理员密码（请保密）

请在本地或通过 wrangler 将其作为 Secret 设置：

```bash
wrangler secret put ADMIN_PASSWORD
# 然后在弹出的输入密码
```

> 注意：已从 `wrangler.toml` 中移除明文 `ADMIN_PASSWORD`。部署到生产环境前，请使用 `wrangler secret put ADMIN_PASSWORD` 或在 CI/CD 中将其作为 Secret 设置，切勿将明文密码提交到仓库。

5. 初始化 D1 schema：

```bash
# 在 Cloudflare D1 控制台创建数据库，例如 `firefly_comments`，或通过 wrangler 创建：
# wrangler d1 create --name firefly_comments --project-name firefly-comments
# 然后执行 migrations（推荐使用 pnpm 脚本）：
pnpm migrate
# 或者直接运行：
wrangler d1 execute --database firefly_comments migrations/create_tables.sql
```

> 注意：如果数据库已存在但缺少 `ip` 或 `user_agent` 列，可以在 D1 控制台运行 `ALTER TABLE` 添加列（迁移文件已包含说明）。

## CI / 自动部署（示例）

我已添加了一个 GitHub Actions 示例工作流（`.github/workflows/ci.yml`），用于在 `main` 分支构建、运行迁移并在有 `CF_API_TOKEN` 时部署到 Cloudflare。将 `CF_API_TOKEN` 设置到仓库 Secrets 后，推送到 `main` 即可自动部署。


6. 本地开发：

```bash
wrangler dev
```

7. 运行本地测试（可选）：

```bash
# 在另一个终端窗口启动 wrangler dev
# 然后运行测试脚本（请通过环境变量传入管理员密码）
ADMIN_PASSWORD=your_admin_password node tests/test_api.js
```

8. 部署：

```bash
wrangler publish
```

## 嵌入到 Astro

在文章模板中引入 `embed.js`，并替换为你的 Worker 部署域名：

```html
<script src="https://your-worker-domain.workers.dev/embed.js" data-comments-url="https://your-worker-domain.workers.dev" async></script>
<div id="firefly-comments"></div>
```

## GitHub Secrets 与分支保护（部署安全）

在将仓库推送到 GitHub 并启用 CI 之前，请务必将敏感凭据添加为仓库 Secrets，避免将明文写入 `wrangler.toml` 或代码中。

- 添加 Secrets：在 GitHub 仓库页面 -> Settings -> Secrets and variables -> Actions -> New repository secret
	- `CF_API_TOKEN`：Cloudflare API token（需包含 D1 与 Workers 的读写/发布权限）
	- `ADMIN_PASSWORD`：管理员密码（用于本地测试或 CI 脚本，如果在生产环境下不要在仓库公开）

- 推荐的 Action 配置说明：CI 工作流会在没有 `CF_API_TOKEN` 时跳过迁移与部署步骤，因此在启用自动部署前请先在仓库 Secrets 中添加 `CF_API_TOKEN`。

- 分支保护建议：在 GitHub → Settings → Branches → Branch protection rules 中为 `main` 添加规则：
	- Require pull request reviews before merging
	- Require status checks to pass before merging（选择 CI 工作流）
	- Include administrators（可选）

示例命令（在本地，先登录 wrangler，再把 secret 设置到你的账户或 CI）：

```bash
# 在本地将管理员密码设置为 Cloudflare Secret（交互式）
wrangler secret put ADMIN_PASSWORD

# 在 CI（例如 GitHub Actions）中，打开仓库 Settings → Secrets，分别添加 `CF_API_TOKEN` 与 `ADMIN_PASSWORD`。
```

## 管理后台

访问 `https://your-worker-domain.workers.dev/admin`，输入管理员密码以查看待审核评论并进行审核或删除。

## 许可证

本项目采用 MIT 许可证（`LICENSE` 文件）。

---

> 声明：此项目骨架由 GitHub Copilot 协助创建。