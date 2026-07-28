# Mankr Flarepost 手动部署指南

从零到能收发信的完整步骤。全程不需要绑定信用卡。

按顺序做完 11 步即可；每一步都标注了「在哪里设置」和「怎么验证这步成功了」。

> 关于 README 里的 Deploy to Cloudflare 按钮：它会把本仓库**克隆成一个新仓库**再接 CI，之后你往原仓库推的代码不会生效。那个按钮是给别人一键拿走用的，你自己发版请走本文的手动路径。

---

## 变量速查表

所有配置项**都在 Cloudflare 侧设置，仓库里一个都不存**。

必填三项，收发信缺一不可：

| 名称 | 类型 | 设置位置 | 说明 |
|------|------|----------|------|
| `EMAIL_DOMAIN` | 明文变量 | Dashboard（或 `wrangler secret put` 之外的 Text 类型） | 你的邮件域名，别名后缀 |
| `COOKIES_SECRET` | Secret | `wrangler secret put` 或 Dashboard | 会话签名密钥 |
| `RESEND_API_KEY` | Secret | `wrangler secret put` 或 Dashboard | 发信凭证 |

可选两项，只影响 `/usage`「用量」页里的 Cloudflare 卡片，不配就显示「未配置」，收发信照常：

| 名称 | 类型 | 设置位置 | 说明 |
|------|------|----------|------|
| `CLOUDFLARE_ACCOUNT_ID` | 明文变量 | Dashboard 或 `.dev.vars` | 账号 ID，`npx wrangler whoami` 可查 |
| `CLOUDFLARE_API_TOKEN` | Secret | `wrangler secret put` 或 Dashboard | 只读用量 token，权限见步骤 6 |

两项**缺一即视为未配置**，不会拿半套凭证去打接口。Resend 卡片复用已有的 `RESEND_API_KEY`，不需要额外配置。

必填三项由 **步骤 6** 统一设置，`wrangler.toml` 里不含任何一个——这是公开仓库，域名写进 `[vars]` 会跟着每个 fork 跑。仓库里有 `keep_vars = true`，所以 `wrangler deploy` 不会覆盖你在 Dashboard 里设的明文变量（Secret 本来就不会被覆盖）。

本地开发是另一套：这些值都写在 `.dev.vars` 里，该文件已被 gitignore。

---

## 前提条件

| 项 | 要求 |
|----|------|
| Cloudflare 账号 | 免费账号即可，**不需要**绑卡 |
| 域名 | DNS 必须托管在 Cloudflare（Email Routing 依赖） |
| Resend 账号 | 免费层，[resend.com](https://resend.com) 注册，不需要绑卡 |
| Node.js | ≥ 22.12 |
| pnpm | 11.17.0（仓库 `packageManager` 已钉扎） |

---

## 步骤 1：准备本地环境

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
```

**验证：** `pnpm -v` 输出 `11.17.0`，`node -v` ≥ `v22.12.0`。

---

## 步骤 2：登录 Cloudflare

```bash
npx wrangler login
```

会弹出浏览器要求授权，点 Allow。

**验证：**

```bash
npx wrangler whoami
```

应显示你的邮箱和 Account ID。如果显示 `You are not authenticated`，重新跑一次 login。

> 在没有浏览器的机器上（比如服务器），改用 API Token：在 Cloudflare 后台 My Profile → API Tokens 建一个带 **Workers Scripts: Edit** 和 **D1: Edit** 权限的 token，然后 `export CLOUDFLARE_API_TOKEN=xxx`。

---

## 步骤 3：确认 `wrangler.toml`

一般情况下**这一步什么都不用改**。域名之类的配置不在这里，见步骤 6。

只有一处你可能想改——Worker 的名字：

```toml
name = "mankr-flarepost"    # 可自定义，但改了之后要一直用这个
```

改名等于换了一个新 Worker：`wrangler deploy` 会创建新的，旧的仍然占着原来的域名和 Email Routing 规则。所以要么一开始就定好，要么改完记得把域名和路由重新指过来。

`[[d1_databases]]` 里的 `database_id` 是全零占位符，**不用动**——部署脚本会自动解析成真实 ID。

---

## 步骤 4：确认 D1 数据库

```bash
npx wrangler d1 list
```

看列表里有没有名为 `mankr-flarepost` 的库（要和 `wrangler.toml` 里的 `database_name` 一致）：

- **已经有** → 什么都不用做，下一步会自动用它。
- **没有，且账号里也没有别的 D1** → 下一步会自动创建。
- **没有，但账号里有别的 D1** → 脚本会拒绝自动建库（防止误建空库看起来像数据丢了）。三选一：
  - 把 `wrangler.toml` 的 `database_name` 改成列表里真实存在的那个名字；
  - 或者部署时带上已知 ID：`D1_DATABASE_ID=<uuid> pnpm run deploy`；
  - 或者确认就是要建新库：`D1_ALLOW_CREATE=1 pnpm run deploy`。

---

## 步骤 5：首次部署

```bash
pnpm run deploy
```

> 必须写 `pnpm run deploy`，不能写 `pnpm deploy`——后者是 pnpm 自带的子命令，不会执行本仓库的脚本。

这一条命令依次做四件事：

1. `pnpm build` — 构建前端 SPA 和 Worker
2. `db:ensure` — 解析（或创建）真实 D1，把 ID 写进 `wrangler.deploy.toml`（这个文件已被 gitignore）
3. `wrangler d1 migrations apply DB --remote` — 在远程 D1 上跑数据库迁移
4. `wrangler deploy` — 上传 Worker

**验证：** 命令末尾会打印一个 `https://mankr-flarepost.<你的子域>.workers.dev` 地址。现在打开它会看到界面，但还不能登录——Secret 还没设。

如果输出里没有 workers.dev 地址，去 Dashboard → 你的 Worker → Settings → Domains & Routes，把 `workers.dev` 开关打开。

---

## 步骤 6：设置环境变量

登录、发信、别名后缀分别依赖这三个必填值，全部在 Cloudflare 侧设置：

| 名称 | 类型 | 值 |
|------|------|-----|
| `COOKIES_SECRET` | Secret | `openssl rand -hex 32` 的输出 |
| `RESEND_API_KEY` | Secret | Resend 的 `re_` 开头 key（步骤 7 才拿得到，可以回头再设） |
| `EMAIL_DOMAIN` | 明文 / Text | 你的域名，如 `example.com`，不带 `@`、不带子域前缀 |

`EMAIL_DOMAIN` 决定别名后缀：设成 `example.com`，别名就是 `you@example.com`。

### 方式 A：命令行

```bash
openssl rand -hex 32          # 先生成会话密钥，复制输出

npx wrangler secret put COOKIES_SECRET
# 粘贴刚才那串 64 位十六进制，回车

npx wrangler secret put RESEND_API_KEY
# 粘贴 re_ 开头的 key，回车
```

粘贴时终端不回显字符，是正常的。

**验证：**

```bash
npx wrangler secret list
```

应列出这两个名字（不显示值）。

`EMAIL_DOMAIN` 不是 Secret，命令行没有对应的 put 子命令，用下面的 Dashboard 方式设置。

### 方式 B：Dashboard（找不到入口就照这个点）

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 左侧菜单 **Compute (Workers)** → **Workers & Pages**
3. 在列表里点你的 Worker（`mankr-flarepost`）
4. 顶部切到 **Settings** 标签
5. 找到 **Variables and Secrets** 这一节
6. 点 **Add**，按上面表格逐个添加：
   - `COOKIES_SECRET` 和 `RESEND_API_KEY` → **Type** 选 **Secret**
   - `EMAIL_DOMAIN` → **Type** 选 **Text**（明文，它不是密钥）
7. 每加完一个点 **Deploy** / **Save** 保存

> 找不到 **Variables and Secrets**？说明 Worker 还没部署成功过——先做完步骤 5。
>
> 这里设的值**不会**被后续 `pnpm run deploy` 覆盖：仓库 `wrangler.toml` 里有 `keep_vars = true`，Secret 本身也从不被部署覆盖。

### 方式 C：可选——打开「用量」页的 Cloudflare 卡片

`/usage` 页展示免费额度的消耗情况。Resend 那半边复用 `RESEND_API_KEY`，开箱可用；Cloudflare 那半边需要再加两个值，不加就显示「未配置」，收发信不受影响。

1. 拿 Account ID：

```bash
npx wrangler whoami
```

复制输出里的 Account ID，它不是密钥，用明文 / Text 类型设成 `CLOUDFLARE_ACCOUNT_ID`。

2. 建一个**只读** token：Dashboard 右上头像 → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**，权限只给一条：

| Type | 资源 | 权限 |
|------|------|------|
| Account | Account Analytics | **Read** |

不要给 Workers Scripts Edit、D1 Edit 之类的写权限。和步骤 2 里部署用的 token **分开建**——监控 token 即使泄露也只能读用量。

3. 设成 Secret：

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
# 粘贴刚创建的 token，回车
```

**验证：** 部署后登录，打开 `/usage`，Cloudflare 卡片应显示 Worker 请求数与 D1 读写行数的环形图，而不是「未配置」。

> 页面上的上限值写死的是**免费计划**额度（Workers 10 万请求/天、D1 500 万行读/天、10 万行写/天、5 GB 存储；Resend 100 封/天、3000 封/月）。升级到付费计划后真实上限更高，页面数字只应看作免费额度的参考。
>
> 「无数据」不等于 0：Resend 的每日额度头只对免费账号返回，Paid 账号那一栏会显示无数据。

---

## 步骤 7：在 Resend 拿 API Key 并验证域名

发信的发件人地址就是你的别名地址（`you@EMAIL_DOMAIN`），所以 Resend 必须先验证**整个域名**，否则发信会被拒。

1. 注册并登录 [resend.com](https://resend.com)
2. 左侧 **Domains** → **Add Domain** → 填入你的 `EMAIL_DOMAIN`（例如 `example.com`）
3. Resend 会给出几条 DNS 记录（DKIM 的 TXT、SPF 的 TXT，可能还有 MX）。到 Cloudflare Dashboard → 选中该域名 → **DNS** → **Records** → **Add record**，逐条添加。
   - 记录类型和值原样复制
   - Name 一栏 Cloudflare 会自动补域名后缀，别重复填域名
   - TXT 记录没有橙云开关，不用管代理状态
4. 回到 Resend 点 **Verify**，等状态变成 **Verified**（DNS 生效通常几分钟内）
5. 左侧 **API Keys** → **Create API Key**
   - 权限选 **Sending access**
   - 创建后 `re_` 开头的完整 key **只显示这一次**，立刻复制
6. 回到步骤 6，把这个 key 设成 `RESEND_API_KEY`

> Resend 的 MX 记录和 Cloudflare Email Routing 的 MX 记录可能冲突。收信靠 Cloudflare Email Routing，所以**以 Email Routing 的 MX 为准**；Resend 只负责发信，通常只需要 DKIM/SPF 的 TXT 记录就能验证通过。

---

## 步骤 8：配置 Email Routing（收信）

1. Cloudflare Dashboard → 顶部选中你的**域名**（注意不是 Worker 页面）
2. 左侧 **Email** → **Email Routing**
3. 首次使用点 **Get started** / **Enable**，Cloudflare 会自动帮你添加所需的 MX 和 TXT 记录，确认即可
4. 切到 **Routing rules** 标签
5. 找到 **Catch-all address**，点 **Edit**：
   - **Action** 选 **Send to a Worker**
   - **Destination** 选你的 Worker `mankr-flarepost`
   - 状态设为 **Enabled**，保存

也可以不用 catch-all，改成在 **Custom addresses** 里为每个别名单独建规则，动作同样是 Send to a Worker。

**验证：** Email Routing 页面顶部状态显示 **Enabled**，catch-all 规则指向你的 Worker。

> 收信到 Worker **不需要**验证 destination address——那是「转发到某个邮箱」才需要的。
>
> 邮件到达后，Worker 会查这个收件地址在应用里有没有对应的**已启用别名**；没有就静默丢弃（不退信）。所以步骤 10 建别名之前，收到的信不会出现在收件箱里。

---

## 步骤 9：初始化管理员账号

打开 `https://<你的-workers.dev-地址>/setup`

- 填用户名和密码（**密码至少 8 位**），提交后自动登录
- 这个接口**只在数据库里一个用户都没有时可用**；已经有用户会返回 403 `already_initialized`，这时直接去 `/login`

如果这一步报错，几乎都是 `COOKIES_SECRET` 没设（回到步骤 6）。

> 想绑自定义域名（比如 `mail.example.com`）：Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**。绑定后用自定义域访问即可，`/setup` 同理。

---

## 步骤 10：创建别名（最多 5 个）

登录后进入 `/aliases` 页面，点新建：

- 可以只填本地部分（`hello`），也可以填完整地址（`hello@example.com`）
- 后缀必须等于 `EMAIL_DOMAIN`，否则会被拒绝
- 本地部分只允许 `a-z 0-9 . _ + -`
- 第一个创建的别名自动成为默认发件地址
- 上限 5 个，第 6 个会返回 `alias_limit`

---

## 步骤 11：验证收发

**收信：** 从外部邮箱（Gmail 之类）发一封到你刚建的别名 → 应该出现在收件箱。

**发信：** 在界面里回复这封信，或点写信 → 对方应该收到，同时 `/sent` 里出现记录。

发信失败时，接口返回的错误码对照：

| 错误码 | HTTP | 含义与处理 |
|--------|------|------------|
| `not_configured` | 502 | `RESEND_API_KEY` 没设或为空 → 回步骤 6 |
| `invalid_address` | 400 | 发件域没在 Resend 验证通过，或收件地址格式不对 → 回步骤 7 |
| `provider_error` | 502 | Resend 侧失败（配额、服务异常）→ 去 Resend 后台看日志 |
| `rate_limited` | 429 | 应用内限流，每个别名每小时 30 封 |

---

## 日常更新与回滚

**改完代码发新版本：**

```bash
pnpm run deploy
```

没有接 CI，`git push` **不会**自动部署，必须手动跑这条命令。

**回滚：** Worker → **Deployments** → 找到旧版本 → **Rollback**。

**只补跑数据库迁移**（比如之前只跑了 `wrangler deploy`）：

```bash
pnpm run db:migrate:remote
```

---

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # 填入 COOKIES_SECRET、RESEND_API_KEY、EMAIL_DOMAIN
pnpm run db:migrate:local
pnpm dev
```

前端 http://localhost:5173，后端 http://127.0.0.1:8787。首次打开 `/setup` 建本地管理员。

`.dev.vars` 只作用于本地，不会上传，也不要提交。

---

## 常见问题

**部署成功了，但线上还是旧版本。**
先确认你访问的域名绑的是哪个 Worker。改过 `wrangler.toml` 里的 `name` 之后，`wrangler deploy` 会创建一个**新的** Worker，旧的那个仍然占着原来的域名。另外别只看 HTTP 200 判断——SPA 回退会让任何路径都返回 200，要抓 bundle 验证：

```bash
curl -s https://<你的域名>/ | grep -o 'index-[^"]*\.js'
```

**`db:ensure` 报 `no D1 named ... but these exist`。**
`database_name` 和账号里真实的 D1 名字对不上。见步骤 4 的三种处理方式。

**`/setup` 返回 403。**
管理员已存在，去 `/login`。忘记密码只能用 `wrangler d1 execute` 直接操作数据库重置。

**能收不能发。**
按步骤 11 的错误码表定位，九成是 `RESEND_API_KEY` 没设或 Resend 域名没验证。

**能发不能收。**
检查三件事：Email Routing 的 catch-all 规则是否指向 Worker 且已启用；`/aliases` 里对应别名是否存在且启用；别名后缀是否等于 `EMAIL_DOMAIN`。

**别名创建失败，返回 `invalid_address`。**
三种可能：`EMAIL_DOMAIN` 根本没设（域名为空时后端直接拒绝，回步骤 6）；填的后缀不等于 `EMAIL_DOMAIN`；本地部分含 `a-z 0-9 . _ + -` 之外的字符。已经有 5 个时报的是 `alias_limit`。

---

## 能力边界

- 单用户、单域名、最多 5 个别名
- **不支持附件**：开通 R2 需要账号绑卡，与「零信用卡」冲突。含附件的来信只保留正文，详情页会提示
- 发信只走 Resend：Cloudflare Email Sending 发给任意收件人需要 Workers Paid；MailChannels 的免费 Workers 通道已于 2024-06-30 下线

---

## 相关文档

- [README](../README.md)
- [对外发信 API](./API.md)
- [PRD](./superpowers/specs/2026-07-25-cloudflare-personal-mail-prd.md)
- [架构](./superpowers/specs/2026-07-25-cloudflare-personal-mail-architecture.md)
