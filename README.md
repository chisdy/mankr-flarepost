# Mankr Mail

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

将下方仓库 URL 换成你的公开 GitHub/GitLab 地址后使用：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_ORG/mankr-maill)

部署完成后务必：

1. 设置 Secret：`COOKIES_SECRET`（必填）；若用 Resend，再设 `RESEND_API_KEY`
2. 设置变量：`EMAIL_DOMAIN`、`SEND_CHANNEL`（Total Free 推荐 `resend`）
3. 按 [部署清单](./docs/DEPLOY.md#部署后清单) 配置 Email Routing、打开 `/setup`、创建别名并测收发

## 本地开发

**要求：** Node.js ≥ 22.12，pnpm 经 Corepack（仓库钉扎 `pnpm@11.17.0`）。

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
pnpm db:migrate:local
# 复制 .dev.vars.example → .dev.vars，填入 COOKIES_SECRET 等
pnpm dev
```

首次启动后打开 `/setup` 创建管理员（仅当 `users` 表为空时可用）。

## 手动部署（兜底）

```bash
pnpm install
pnpm db:migrate:remote
pnpm deploy
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
