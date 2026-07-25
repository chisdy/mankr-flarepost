# Mankr Flarepost

面向个人站长的轻量域名邮件客户端：在 Cloudflare 免费层内完成日常收、读、写、回。

单用户 · 单域名 · 最多 5 个别名 · 无附件 · Web 收发闭环。

## 能力边界（V1 / P0）

| 项 | 限制 |
|----|------|
| 用户 | 单管理员账号 |
| 域名 | 单域名（`EMAIL_DOMAIN`） |
| 别名 | 最多 **5** 个 |
| 附件 | 不支持（入站仅可能展示附件提示） |
| 发信（Total Free） | Cloudflare 向任意收件人发信需 Workers **Paid**；零信用卡任意外发请用 `SEND_CHANNEL=resend` + Resend Free API Key |

完整部署步骤见 **[docs/DEPLOY.md](./docs/DEPLOY.md)**。

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chisdy/mankr-flarepost)

部署完成后务必：

1. **D1 migrations：** `pnpm deploy` 会自动 `wrangler d1 migrations apply mankr-flarepost --remote`。若只用 Dashboard Deploy 按钮（未必跑完整 npm `deploy` script），请补跑一次 `pnpm db:migrate:remote`
2. 设置 Secret：`COOKIES_SECRET`（必填）；若用 Resend，再设 `RESEND_API_KEY`
3. 设置变量：`EMAIL_DOMAIN`、`SEND_CHANNEL`（Total Free 推荐 `resend`）
4. 按 [部署清单](./docs/DEPLOY.md#部署后清单) 配置 Email Routing、打开 `/setup`、创建别名并测收发

## 国际化

Web UI 使用 `i18next`，当前内置 **English (`en`)** 与 **简体中文 (`zh-CN`)**。语言偏好保存在 `localStorage`（键 `mankr.locale`），也可在侧栏 / 登录页切换。

新增语言：在 `apps/web/src/i18n/locales/` 增加 JSON，并把它加入 `apps/web/src/i18n/index.ts` 的 `SUPPORTED_LOCALES` 与 `resources`。

## 本地开发

**要求：** Node.js ≥ 22.12，pnpm 经 Corepack（仓库钉扎 `pnpm@11.17.0`）。

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
pnpm db:migrate:local
# 可选：写入演示别名与邮件（需已有 users；会清空 aliases/messages）
pnpm db:seed:local
# 复制 .dev.vars.example → .dev.vars，填入 COOKIES_SECRET 等
pnpm start   # 一键启动前端 Vite + 后端 Worker（等同 pnpm dev）
```

- 前端：http://localhost:5173（`/api` 代理到 Worker）
- 后端：http://127.0.0.1:8787

首次启动后打开 `/setup` 创建管理员（仅当 `users` 表为空时可用）。

## 手动部署（兜底）

```bash
pnpm install
pnpm deploy   # build + remote D1 migrations + wrangler deploy
```

细节与发信渠道说明见 [docs/DEPLOY.md](./docs/DEPLOY.md)。

## 仓库结构

```text
apps/web      # React SPA（Vite + shadcn）
apps/worker   # Hono API + Email Routing handler + D1
wrangler.toml # 单体 Worker + Assets + D1
docs/         # 部署与规格文档
```

## 文档

- [部署指南](./docs/DEPLOY.md)
- [PRD](./docs/superpowers/specs/2026-07-25-cloudflare-personal-mail-prd.md)
- [架构](./docs/superpowers/specs/2026-07-25-cloudflare-personal-mail-architecture.md)
