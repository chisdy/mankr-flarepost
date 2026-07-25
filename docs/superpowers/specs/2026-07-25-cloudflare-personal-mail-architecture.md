# 技术选型与架构：Mankr Flarepost

| 项 | 内容 |
|----|------|
| 文档类型 | 技术选型与架构设计 |
| 工作名 | Mankr Flarepost（仓库：`mankr-flarepost`） |
| 日期 | 2026-07-25 |
| 状态 | 已确认（待实现计划） |
| 关联 PRD | [2026-07-25-cloudflare-personal-mail-prd.md](./2026-07-25-cloudflare-personal-mail-prd.md) |
| 参考项目 | [oiov/vmail](https://github.com/oiov/vmail)、[0xdps/emailflare](https://github.com/0xdps/emailflare) |

---

## 1. 目标与约束回顾

本架构落实 PRD 中的：

- 个人域名 Web 邮件客户端（非临时邮、非发信 SaaS）
- 单用户、单域名 V1、≤5 个别名
- 轻量收发闭环 + 一键部署到 Cloudflare
- **Total Free**：Cloudflare 与可选第三方均停在免信用卡 Free Tier

架构选型原则：部署面最小、免费层可永久运行、前端现代可维护、发信可插拔。

---

## 2. 选定方案

**Workers 单体 + 静态资源同部署 + D1 + 可插拔发信（默认 Cloudflare）。**

不采用 Pages + 独立 Worker 双部署，也不采用 emailflare 式多服务拆分。

### 2.1 一句话架构

**一个 Cloudflare Worker** 同时承载：SPA 静态资源、JSON API、Email Routing 收信处理；数据在 **D1**；发信经 **Send Adapter**（默认 `cloudflare`，可选 `resend` / `mailchannels` 免费层）。

### 2.2 逻辑视图

```text
┌─────────────────────────────────────────────────────────┐
│                     Cloudflare Edge                     │
│                                                         │
│  Browser ──HTTPS──► Worker                              │
│                      ├─ Assets (Vite SPA)               │
│                      ├─ /api/* (Hono)                   │
│                      ├─ Session (signed cookie)         │
│                      └─ Email Handler (Routing)         │
│                              │                          │
│                              ▼                          │
│                           D1 DB                         │
│                      (users/aliases/messages)           │
│                              │                          │
│                      Send Adapter                       │
│                 ┌────────────┼────────────┐             │
│                 ▼            ▼            ▼             │
│            cloudflare     resend     mailchannels       │
└─────────────────────────────────────────────────────────┘

外部依赖（域名侧，非应用代码）：
  DNS @ Cloudflare + Email Routing → Worker
```

### 2.3 运行时职责切分

| 边界 | 职责 | 不负责 |
|------|------|--------|
| **SPA（Browser）** | 登录、收件箱、读信、写信/回复、别名管理、文件夹 UI | 直接碰 D1 / 原始 MIME / 发信密钥 |
| **Worker API** | 鉴权、CRUD、发信编排、错误分类返回 | SSR 页面渲染（V1 纯 SPA） |
| **Email Handler** | 解析入站邮件、按已启用别名入库 | 对未启用地址做复杂投递 |
| **D1** | 用户、别名、邮件元数据与正文 | 大附件（V1 无附件） |
| **Send Adapter** | 统一 `send(...)` 投递 | 业务鉴权与别名策略（API 层先做） |

---

## 3. 技术选型

### 3.1 前端（已锁定）

| 层 | 选型 | 版本取向 | 用途 |
|----|------|----------|------|
| UI 框架 | React | 19.x | SPA 邮件客户端 |
| 构建 | Vite | 8.x（Rolldown） | 开发与生产构建 |
| 语言 | TypeScript | 7.x | 全仓类型 |
| 组件 | shadcn/ui | `shadcn@latest` + 指定 preset | 见 §3.1.1；禁止手写另起一套主题配置覆盖 preset |
| 样式 | Tailwind CSS | 由上述 shadcn init 按 preset 配置 | 不另行自选 base color / 字体栈覆盖 preset |
| 图标 | Phosphor Icons | `@phosphor-icons/react` | UI 图标；若 preset 已绑定图标库，与之保持一致，冲突时以 preset 为准并文档注明 |
| 路由 | React Router | 7.x | 客户端路由 |
| 数据请求 | 原生 `fetch` + 轻量封装 | — | V1 不做 React Query |
| 表单 | React Hook Form + Zod | 最新稳定 | 登录、写信、别名校验 |

Node 要求：≥ 20.19 或 ≥ 22.12（Vite 8）。

#### 3.1.1 shadcn/ui 初始化（已锁定）

前端 UI 体系 **必须** 用已配置好的 preset 初始化，不得改用其他 preset，也不得跳过 preset 走交互式自选主题：

```bash
pnpm dlx shadcn@latest init --preset b39gyV42i --template vite
```

约定：

1. **Preset 码 `b39gyV42i` 为产品设计系统唯一来源**（颜色、主题、圆角、字体等已由创建者配置完成）。实现与代理不得尝试解码或手工复刻该 preset；一律交给官方 CLI 解析。
2. 在 monorepo 中应对 `apps/web` 执行（可用 `--cwd apps/web`，或以该目录为 cwd 运行上述命令）；脚手架若由该命令直接创建 Vite 工程，再迁入 / 对齐 workspace 结构，原则是 **最终 `apps/web` 的 shadcn 配置来自该 preset**。
3. 后续组件一律：`pnpm dlx shadcn@latest add <component>`（同样在 `apps/web` 下）。
4. 更换视觉只能通过更换 / 重新 apply 官方 preset 流程；V1 不允许私自改 `components.json` 主风格与 CSS 变量体系绕开 preset。

参考：[shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)、[CLI](https://ui.shadcn.com/docs/cli)。

### 3.2 边缘后端与存储

| 层 | 选型 | 用途 |
|----|------|------|
| 运行时 | Cloudflare Workers | API、收信、静态资源、一键部署目标 |
| HTTP | Hono | Worker 内路由 |
| 数据库 | Cloudflare D1 | 持久化 |
| 迁移 | Wrangler D1 migrations | schema 版本化 |
| 入站 | Cloudflare Email Routing → Worker | 入站进 handler |
| 出站 | Send Adapter | `cloudflare` \| `resend` \| `mailchannels` |
| 密钥 | Wrangler Secrets | cookie 密钥、可选第三方 API Key |
| 配置 | `wrangler.toml` + env | 域名、发信渠道等 |

### 3.3 鉴权与安全

| 项 | 选型 | 说明 |
|----|------|------|
| 会话 | 签名 HttpOnly Cookie | 单用户 SPA；不把 JWT 放 localStorage |
| 密码 | Worker 可行的强哈希（PBKDF2 / scrypt 择一） | 初始化写入唯一用户 |
| CSRF | SameSite + 写操作校验 | 原则定此，细节实现落地 |
| HTML 读信 | DOMPurify（或等价） | 前端净化 |
| 限流 | per-IP / per-mailbox 简单计数 | 保护免费发信配额 |

登录身份：单一用户主体（建议主别名邮箱作用户名）+ 一个密码；别名不是独立登录账号。

### 3.4 发信适配器契约

```ts
type SendErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'invalid_address'
  | 'provider_error'

interface SendAdapter {
  send(input: {
    from: string
    to: string[]
    subject: string
    text: string
    html?: string
    replyTo?: string
  }): Promise<{ id?: string } | { error: SendErrorCode }>
}
```

- 环境变量：`SEND_CHANNEL=cloudflare | resend | mailchannels`（默认 `cloudflare`）
- API 层先做：登录态、别名归属、频率限制；Adapter 只负责投递
- 固定发件策略（若渠道要求 `SENDER_EMAIL`）与别名 `Reply-To` 的细节在实现计划中按渠道文档落地，但不得破坏「默认路径零第三方账号」

### 3.5 一键部署与工具链

| 项 | 选型 | 说明 |
|----|------|------|
| 包管理 | **pnpm 最新稳定版** | 实现与文档一律使用当下最新 stable（撰写时为 11.x；以 `pnpm self-update` / 官网为准）；禁止锁定过旧大版本 |
| 版本钉扎 | `package.json` → `packageManager` | 例如 `"packageManager": "pnpm@11.17.0"`，随仓库升级到最新 stable；Corepack / 一键部署环境与之对齐 |
| 部署主路径 | Deploy to Cloudflare（或官方等价一键模板） | P0；实现阶段只钉一种载体 |
| 部署兜底 | `pnpm build && pnpm deploy` + 文档 | PRD 手工路径 |
| CI | GitHub Actions → 启用 Corepack + 上述 `packageManager` → Wrangler | 可选 P1，不阻塞一键主路径 |

### 3.6 明确不选（V1）

| 不选 | 原因 |
|------|------|
| Cloudflare Pages 独立前端 | 双部署，削弱一键路径 |
| R2 / KV 作主存储 | V1 无附件；正文走 D1 |
| Next.js / Remix SSR | 与单体 Worker SPA 不符 |
| Prisma 等重 ORM | Worker/D1 过重 |
| 公网 Open API Key | PRD 非目标 |
| React Query / 大型状态库 | YAGNI |

---

## 4. 仓库与模块结构

### 4.1 仓库形态

pnpm workspace（**要求使用最新稳定版 pnpm**，经 `packageManager` 字段钉扎），单仓两包，一次部署：

```text
mankr-flarepost/
  apps/
    web/          # React 19 + Vite 8 + shadcn/ui + Phosphor
    worker/       # Hono API + email handler + adapters + D1
  docs/
    superpowers/specs/
  wrangler.toml   # 根或 worker 包内（实现时二选一，保持一键简单）
  package.json
  pnpm-workspace.yaml
```

前端构建产物由 Worker **Assets** 托管。

### 4.2 `apps/web` 模块

| 模块 | 职责 |
|------|------|
| `auth` | 登录/登出、会话态 |
| `mailbox` | 收件箱/已发送/垃圾箱列表与已读 |
| `message` | 读信（HTML 净化）、删除/恢复 |
| `compose` | 新写信、回复 |
| `aliases` | 别名 CRUD、默认发件别名 |
| `settings`（P1） | 显示名等；改密码入口可放此或 auth |
| `onboarding`（P1） | 首次引导：域名绑定/测收信 |

### 4.3 `apps/worker` 模块

| 模块 | 职责 |
|------|------|
| `http` | Hono 路由、错误映射、auth/rate-limit 中间件 |
| `auth` | 登录、cookie、改密码 |
| `aliases` | 上限 5、启用态、默认发件 |
| `messages` | 列表/详情/文件夹/已读 |
| `send` | 组信、调 Adapter、写已发送或返回错误 |
| `inbound` | Email Routing：MIME → 入库 |
| `adapters/send/*` | cloudflare / resend / mailchannels |
| `db` | D1 访问与 migrations |
| `assets` | 托管 Vite `dist` |

---

## 5. 数据模型草图（D1）

```text
users
  id, username, password_hash, display_name?, created_at

aliases
  id, address, enabled, is_default, created_at
  UNIQUE(address)
  应用层约束: COUNT(*) <= 5

messages
  id, alias_id,
  folder (inbox | sent | trash),
  direction (inbound | outbound),
  from_addr, to_addrs,
  subject, text_body, html_body?,
  is_read,
  provider_message_id?,
  has_unsupported_attachments (bool),
  last_error_code?,          -- 出站失败可解释性（可空）
  created_at, deleted_at?
```

建议索引：

- `(folder, created_at DESC)`
- `(alias_id, folder, created_at DESC)`

精确 DDL 在实现计划/首个 migration 中定稿；本表为逻辑模型。

---

## 6. 核心数据流

### 6.1 收信

```text
外部 SMTP → Email Routing → Worker inbound
  → 收件人匹配 enabled alias？
  → 否：不入库
  → 是：messages(folder=inbox)
       含附件 → has_unsupported_attachments=true，仍存正文
```

### 6.2 读信 / 整理

```text
SPA → GET /api/messages?folder=…
SPA → GET /api/messages/:id → 前端净化 html_body
SPA → 删除/恢复/清空 → 更新 folder 或物理删除
```

### 6.3 写信 / 回复

```text
SPA → POST /api/messages/send
  → auth + from ∈ enabled aliases
  → rate limit
  → SendAdapter.send
  → 成功：folder=sent
  → 失败：返回 SendErrorCode，不假写入已发送
```

### 6.4 鉴权

```text
初始化：唯一 users 行
登录：校验密码 → Set-Cookie (signed, HttpOnly)
API：校验 cookie；失败 401
登出：清 cookie
```

### 6.5 一键部署后人工步骤

```text
一键部署 Worker + D1 + migrations + assets
  → 配置 secrets / EMAIL_DOMAIN / SEND_CHANNEL
  → Email Routing 指向该 Worker
  → 初始化管理员
  → 创建别名并测收发
```

---

## 7. 对内 API 面（非公开 Open API）

| 方法 | 路径（示意） | 说明 |
|------|----------------|------|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| POST | `/api/auth/password` | 改密码（P0 能力） |
| GET/POST/PATCH | `/api/aliases` | 别名管理 |
| GET | `/api/messages` | 按 folder 列表 |
| GET | `/api/messages/:id` | 详情 |
| POST | `/api/messages/send` | 新写/回复 |
| POST | `/api/messages/:id/trash` 等 | 删/恢复/已读 |
| DELETE | `/api/messages/trash` | 清空垃圾箱 |

全部需要会话；不提供 API Key。

---

## 8. Total Free 与一键部署

### 8.1 免费层硬边界

| 资源 | V1 策略 |
|------|---------|
| Workers | 单实例：Assets + API + 收信 |
| D1 | 单库；无附件；可后续加保留/体积上限 |
| Email Routing | 域名在 Cloudflare |
| 发信 | 默认 CF；可选第三方仅 Free Tier |
| 第三方 | 可选；默认一键路径不得强制绑信用卡 |
| 禁止 | R2 必选、付费 Workers 特性、强制付费 SMTP |

新依赖检查清单：免信用卡？可永久 Free Tier？破坏则不得进 P0。

### 8.2 一键部署原则

1. 主路径：Deploy to Cloudflare（或官方等价模板）；实现只钉一种。
2. 一键覆盖：Worker、D1、migrations、静态资源；引导 `EMAIL_DOMAIN`、`COOKIES_SECRET`、`SEND_CHANNEL`。
3. 一键不覆盖：Email Routing/MX、初始化管理员、别名、测收发——文档最短清单必须写清。
4. 兜底：`pnpm install && pnpm build && pnpm deploy`。
5. 可选发信密钥：部署后 `wrangler secret put`，永不进仓库。

### 8.3 本地开发

```text
pnpm dev
  ├─ Vite 8（apps/web）
  └─ wrangler dev（apps/worker，同源/代理 API）
```

入站可用 fixture/模拟；UI 与 API 开发不依赖真实 MX。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| CF 发信能力/到达率变化 | Adapter 可切换；错误码可解释；文档不承诺企业送达率 |
| D1 免费限额 | 无附件；列表分页；可加保留策略 |
| 一键无法完成 MX/Routing | 「部署后必做」最短清单 + 验收步骤 |
| 复杂 MIME | V1 保纯文本/简单 HTML；其余降级可读文本 |
| HTML XSS | 前端强制净化 |
| 密钥泄露 | 仅 Secrets / 一键机密配置 |

---

## 10. 与 PRD 里程碑映射

| PRD 阶段 | 架构落点 |
|----------|----------|
| M1 | 本文 |
| M2 | worker inbound + auth + aliases + web 读收件箱 |
| M3 | send adapter + compose/reply + sent/trash |
| M4 | 一键部署模板 + 文档兜底 + 第二人复现 |

---

## 11. 文档边界

**本文包含：** 选型、运行时边界、模块、逻辑数据模型、数据流、对内 API 示意、免费层与一键部署原则。

**本文不包含：** UI 视觉细稿、最终 SQL DDL、完整 OpenAPI、CI YAML 全文、逐文件实现任务拆解。

**下一步：** 基于 PRD + 本文编写实现计划（writing-plans）。

---

## 12. 决策记录

| 决策点 | 结论 |
|--------|------|
| 整体形态 | Workers 单体 + Assets + D1 |
| 前端 | React 19 / Vite 8 / TypeScript 7 / shadcn/ui（preset `b39gyV42i` + vite template）/ Phosphor Icons |
| API | Hono；签名 Cookie 会话；无公开 API Key |
| 发信 | 可插拔；默认 cloudflare；可选 resend / mailchannels |
| 部署 | 一键 Cloudflare 为主；文档 + CLI 兜底 |
| 仓库 | pnpm workspace（**最新稳定版 pnpm** + `packageManager` 钉扎）：`apps/web` + `apps/worker` |
| 不做 | Pages 双部署、R2、SSR 框架、重 ORM、Open API |
