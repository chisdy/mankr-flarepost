# Mankr Flarepost 部署指南

本文覆盖一键部署、手工 pnpm 路径、部署后清单，以及 Total Free 发信渠道说明。

## 前提条件

| 项 | 说明 |
|----|------|
| Cloudflare 账号 | 免费账号即可；**不必**绑定信用卡即可跑通 Total Free 路径 |
| 域名 DNS | 域名托管在 Cloudflare DNS（Email Routing 依赖） |
| Node.js | ≥ **22.12**（手工路径） |
| pnpm | 经 **Corepack**；仓库 `packageManager` 钉扎 `pnpm@11.17.0` |

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

## 能力边界（部署前请知悉）

- **单用户**：一个管理员账号
- **单域名**：`EMAIL_DOMAIN` 指向你的域名
- **别名上限**：5 个
- **附件**：**不支持**。Cloudflare 要求账号绑定支付方式才能开通 R2，为守住「零信用卡」这条线，本项目不接对象存储；含附件的来信只保留正文，详情页会提示
- **发信**：见下文 [Total Free 发信说明](#total-free-发信说明)

---

## 路径 A：一键 Deploy to Cloudflare

1. 确保本仓库（或你的 fork）为 **公开** GitHub / GitLab 仓库。
2. 点击 README 中的 **Deploy to Cloudflare** 按钮，或打开：

   ```text
   https://deploy.workers.cloudflare.com/?url=<你的仓库 Git URL>
   ```

3. 在向导中确认 Worker 名、D1 等资源；构建命令会使用根目录 `pnpm build` / `pnpm deploy`（Workers Builds 会检测 `package.json` scripts）。

   > **必须核对：** Worker → **Settings → Builds** 里的 **Deploy command** 要是 `pnpm run deploy`。若它是默认的 `npx wrangler deploy`，则既不跑迁移、也会因为仓库里的全零占位 `database_id` 而失败或部署出坏绑定 —— 表现就是「构建成功但线上还是旧版本」。

4. **D1 migrations：** 根目录 `pnpm deploy` 的顺序是 `build` → `db:ensure` → `d1 migrations apply DB --remote` → `wrangler deploy`。`db:ensure`（`scripts/ensure-d1.mjs`）按 `database_name` 查真实 D1、没有就创建，把 ID 写进 gitignore 的 `wrangler.deploy.toml`，后两步都用这份生成配置。已知 ID 时可用环境变量跳过查询：

   ```bash
   D1_DATABASE_ID=<你的-d1-uuid> pnpm deploy
   ```

   若线上迁移落后（例如只跑过 `wrangler deploy`），补跑一次：

   ```bash
   pnpm db:migrate:remote
   ```

5. 部署成功后，在 Cloudflare Dashboard → 该 Worker → **Settings / Variables and Secrets** 中配置：

   | 名称 | 类型 | 必填 | 说明 |
   |------|------|------|------|
   | `COOKIES_SECRET` | Secret | 是 | 会话签名密钥；可用 `openssl rand -hex 32` 生成 |
   | `RESEND_API_KEY` | Secret | 是 | 发信凭证；[resend.com](https://resend.com) 免费层申请 |
   | `EMAIL_DOMAIN` | Var | 是 | 如 `example.com`（勿带 `@`） |

6. 继续完成下方 [部署后清单](#部署后清单)。

> 也可在已部署的 Worker 详情页使用官方「分享」生成 Deploy 按钮片段，贴回你自己的 README。

---

## 路径 B：手工 pnpm 部署

```bash
# 1. 依赖
pnpm install

# 2. 编辑 wrangler.toml
#    - database_id 不用改：db:ensure 按 database_name 解析真实 D1 并写入
#      wrangler.deploy.toml。若你账号里的 D1 显示名不同，改 database_name
#      或用 D1_DATABASE_ID=<uuid> 指定
#    - [vars] 中设置 EMAIL_DOMAIN

# 3. Secrets（勿写入仓库）
npx wrangler secret put COOKIES_SECRET
npx wrangler secret put RESEND_API_KEY

# 4. 构建、远程 D1 migrations、再 wrangler deploy
#    （等价于 build → db:migrate:remote → deploy）
pnpm deploy
```

本地调试：

```bash
cp .dev.vars.example .dev.vars   # 填入本地 secrets
pnpm db:migrate:local
pnpm dev
```

---

## 部署后清单

按顺序完成：

### 1. 确认 D1 migrations 已应用

- [ ] 若用 **`pnpm deploy`**：脚本已包含 `wrangler d1 migrations apply DB --remote`，一般无需再跑
- [ ] 若只用 **Dashboard Deploy 按钮**（可能未跑完整 npm `deploy` script）：本地执行一次 `pnpm db:migrate:remote`

### 2. 确认环境变量与 Secrets

- [ ] `EMAIL_DOMAIN` = 你的域名（如 `mail.example.com` 的根域 `example.com`，与别名后缀一致）
- [ ] `COOKIES_SECRET` 已设置且足够长
- [ ] `RESEND_API_KEY` 已设置，且发信域已在 Resend 侧验证

### 3. Cloudflare Email Routing → Worker

1. Dashboard → **Email** → **Email Routing** → 启用该域名的 Routing。
2. 添加 **Catch-all**（或按别名逐条）规则，动作为 **Send to a Worker**，选择本项目的 `mankr-flarepost` Worker。
3. 按提示完成 MX / SPF 等 DNS 记录（CF 会引导）。

未接到 Worker 的邮件不会进入收件箱。

### 4. 初始化管理员（`/setup`）

1. 打开 Worker 的 `https://<你的-workers-子域>/setup`（或自定义域）。
2. 创建用户名与密码（**仅当库中尚无用户时可成功**；已有用户则拒绝）。
3. 随后使用 `/login` 登录。

### 5. 创建别名（≤ 5）

登录后在设置/别名页创建地址（本地部分或完整 `local@EMAIL_DOMAIN`）。第 6 个会被拒绝。

### 6. 测收发

1. **入站**：从外部邮箱向某一别名发一封测试信 → 收件箱应出现。
2. **回复 / 新写**：在 UI 中回复或撰写 → 检查对方是否收到。
3. **已发送**：确认 Sent 文件夹有对应记录。

若发信报「未配置 / not_configured」：检查 `RESEND_API_KEY` 是否已设置。

---

## Total Free 发信说明

**发信只走 Resend 一条通道**，没有渠道开关。理由是它是唯一能「零绑卡 + 发给任意收件人」的免费路径：

| 方案 | 为什么没有采用 |
|------|----------------|
| Cloudflare Email Sending | 发给任意地址需要 Workers **Paid**；免费层只能发往已验证的 destination |
| MailChannels | 免费的 Workers 直发通道已于 2024-06-30 下线，现需付费方案与密钥 |

配置方式：

```toml
# wrangler.toml [vars]
EMAIL_DOMAIN = "your-domain.com"
```

```bash
npx wrangler secret put RESEND_API_KEY
```

并在 [Resend](https://resend.com) 完成域名/发件人验证（按其免费层文档操作）。未验证的发信域会被 Resend 拒收，表现为 `invalid_address`。

---

## 常见问题

**推送了，但线上还是旧版本？**  
先排除最朴素的那种：提交还在本地。`git status` 的 `ahead of 'origin/main' by N commits` 就是答案，`git log --oneline origin/main..HEAD` 能列出没推上去的提交。注意本地的 `origin/main` 引用可能是过期快照，先 `git fetch origin` 再看。

**构建显示成功，但线上还是旧版本？**  
先确认 Worker → Settings → Builds 的 **Deploy command** 是 `pnpm run deploy`；默认的 `npx wrangler deploy` 会跳过 `db:ensure` 与迁移，并直接使用仓库里的全零占位 `database_id`。再确认你访问的自定义域绑定的是 `wrangler.toml` 里 `name` 指定的那个 Worker —— 改过 `name` 之后 `wrangler deploy` 会写入新脚本，旧脚本仍占着原域名。快速判断线上代码新旧：`curl -s https://<域名>/ | grep -o 'index-[^"]*\.js'` 取到 bundle 后 grep 新功能字符串，别只看 HTTP 状态码（SPA 回退会让任何路径都返回 200）。

**`db:ensure` 报 `no D1 named ... but these exist`？**  
`database_name` 与账号里的真实 D1 显示名不一致（例如只在配置里改过名）。脚本拒绝新建空库以免看起来像数据丢失：把 `database_name` 改成真实名字，或 `D1_DATABASE_ID=<uuid>`；确实要新建才用 `D1_ALLOW_CREATE=1`。

**一键部署后 D1 `database_id` 仍是占位？**  
Deploy to Cloudflare 通常会自动创建并回写 D1 ID。若手工部署，请用 `wrangler d1 create` 后把 ID 写入 `wrangler.toml`。

**`/setup` 返回 403？**  
管理员已存在。请登录；若遗忘密码，需自行用 D1 工具重置或清空用户表后重建（生产请谨慎）。

**能收不能发？**  
优先检查 `RESEND_API_KEY` 是否设置，以及 Resend 侧的域名验证与配额。

**别名创建失败？**  
确认地址后缀等于 `EMAIL_DOMAIN`，且未超过 5 个。

---

## 相关文档

- [README](../README.md)
- [PRD](./superpowers/specs/2026-07-25-cloudflare-personal-mail-prd.md)
- [架构](./superpowers/specs/2026-07-25-cloudflare-personal-mail-architecture.md)
