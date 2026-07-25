# Mankr Mail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可一键部署到 Cloudflare 的单用户个人域名 Web 邮件客户端：鉴权、别名、收信/读信、写信/回复、已发送/垃圾箱，且全程 Total Free。

**Architecture:** 单一 Cloudflare Worker 同时承载 Vite SPA Assets、Hono `/api/*`、Email Routing inbound；数据在 D1；发信经可插拔 Send Adapter（默认 `cloudflare`，可选 `resend` / `mailchannels`）。

**Tech Stack:** pnpm@11.17.0 workspace · React 19 · Vite 8 · TypeScript · shadcn/ui preset `b39gyV42i` · Phosphor · React Router 7 · RHF+Zod · Hono · Cloudflare Workers + D1 · Wrangler

## Global Constraints

- **Total Free：** P0 不得强制绑信用卡；Cloudflare Email Sending 向任意收件人发信需 Workers Paid —— `cloudflare` adapter 仅覆盖「已验证 destination / Paid」路径；**Total Free 任意外发推荐 `SEND_CHANNEL=resend`（Free Tier）**，文档必须写清。
- **别名硬顶 5；** V1 无附件、无搜索、无多用户、无 Open API、无 SSR。
- **包管理：** `"packageManager": "pnpm@11.17.0"`；一律 `pnpm`，禁止 npm/yarn。
- **前端 UI：** 必须 `pnpm dlx shadcn@latest init --preset b39gyV42i --template vite`；禁止手改 preset 主题体系。
- **图标：** `@phosphor-icons/react`（若 preset 冲突以 preset 为准并文档注明）。
- **会话：** 签名 HttpOnly Cookie；密码 PBKDF2；读信 HTML 前端 DOMPurify。
- **仓库：** `apps/web` + `apps/worker`；根 `wrangler.toml` 一键部署；Assets = `apps/web/dist`。
- **提交语言：** commit message 用英文 concise conventional commits（`feat:` / `fix:` / `chore:`）。
- **规格来源：** `docs/superpowers/specs/2026-07-25-cloudflare-personal-mail-prd.md` + `...-architecture.md`。

---

## File Map

```text
mankr-maill/
  package.json
  pnpm-workspace.yaml
  wrangler.toml
  .gitignore
  README.md
  docs/DEPLOY.md
  apps/web/                    # Vite SPA
    package.json
    vite.config.ts
    components.json            # from shadcn preset
    src/
      main.tsx
      App.tsx
      lib/api.ts
      lib/sanitize.ts
      routes/
      features/
        auth/
        mailbox/
        message/
        compose/
        aliases/
  apps/worker/
    package.json
    tsconfig.json
    src/
      index.ts                 # fetch + email export
      env.ts
      http/app.ts              # Hono
      http/middleware.ts
      auth/
      aliases/
      messages/
      send/
      inbound/
      adapters/send/
        types.ts
        cloudflare.ts
        resend.ts
        mailchannels.ts
        index.ts
      db/
        schema.sql             # reference
        client.ts
    migrations/
      0001_init.sql
    scripts/
      init-admin.ts
    tests/
```

---

### Task 1: Monorepo scaffold + Wrangler + D1 migration

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `wrangler.toml`
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/index.ts`, `apps/worker/src/env.ts`
- Create: `apps/worker/migrations/0001_init.sql`
- Create: `apps/web/package.json` (placeholder until shadcn init in Task 6)

**Interfaces:**
- Produces: D1 tables `users`, `aliases`, `messages`; root scripts `dev`/`build`/`deploy`; `Env` type with `DB`, `ASSETS`, `EMAIL?`, secrets

- [ ] **Step 1: Write root workspace files**

`package.json`:
```json
{
  "name": "mankr-maill",
  "private": true,
  "packageManager": "pnpm@11.17.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @mankr/web --filter @mankr/worker dev",
    "build": "pnpm --filter @mankr/web build && pnpm --filter @mankr/worker build",
    "deploy": "pnpm build && wrangler deploy",
    "db:migrate:local": "wrangler d1 migrations apply mankr-mail --local",
    "db:migrate:remote": "wrangler d1 migrations apply mankr-mail --remote",
    "test": "pnpm --filter @mankr/worker test"
  },
  "devDependencies": {
    "wrangler": "^4.28.0",
    "typescript": "^5.9.2"
  }
}
```

> Note: architecture mentions TypeScript 7.x; if `typescript@7` is not yet published on npm at implement time, pin latest stable `5.x`/`7.x` available and note in README. Prefer `@types` compatible with React 19.

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
```

`.gitignore`:
```gitignore
node_modules
dist
.wrangler
.dev.vars
.DS_Store
*.local
.env
.env.*
```

- [ ] **Step 2: Write D1 migration `apps/worker/migrations/0001_init.sql`**

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE aliases (
  id TEXT PRIMARY KEY NOT NULL,
  address TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  alias_id TEXT NOT NULL REFERENCES aliases(id),
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'trash')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  has_unsupported_attachments INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_messages_folder_created ON messages(folder, created_at DESC);
CREATE INDEX idx_messages_alias_folder_created ON messages(alias_id, folder, created_at DESC);
```

- [ ] **Step 3: Write root `wrangler.toml`**

```toml
name = "mankr-mail"
main = "apps/worker/src/index.ts"
compatibility_date = "2026-07-25"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "mankr-mail"
database_id = "local-placeholder-replace-on-deploy"
migrations_dir = "apps/worker/migrations"

[[send_email]]
name = "EMAIL"

[assets]
directory = "apps/web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

[vars]
SEND_CHANNEL = "cloudflare"
EMAIL_DOMAIN = "example.com"
```

- [ ] **Step 4: Minimal worker entry + package**

`apps/worker/package.json`:
```json
{
  "name": "@mankr/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --config ../../wrangler.toml",
    "build": "echo \"worker bundled by wrangler\"",
    "test": "vitest run"
  },
  "dependencies": {
    "hono": "^4.12.32",
    "postalmime": "^2.4.4"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250724.0",
    "vitest": "^3.2.4"
  }
}
```

`apps/worker/src/env.ts`:
```ts
export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  EMAIL?: { send(msg: unknown): Promise<{ messageId?: string }> }
  COOKIES_SECRET: string
  SEND_CHANNEL: 'cloudflare' | 'resend' | 'mailchannels'
  EMAIL_DOMAIN: string
  RESEND_API_KEY?: string
  MAILCHANNELS_API_KEY?: string
  SENDER_EMAIL?: string
}
```

`apps/worker/src/index.ts` (stub):
```ts
import type { Env } from './env'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: true, service: 'mankr-mail' })
    }
    return env.ASSETS.fetch(request)
  },
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // Task 5
    message.setReject('not implemented')
  },
}
```

`apps/web/package.json` placeholder:
```json
{
  "name": "@mankr/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 5: Install and verify migration locally**

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
pnpm db:migrate:local
```

Expected: migration applied to local D1 without error.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: scaffold pnpm workspace, wrangler, and D1 schema

EOF
)"
```

---

### Task 2: Auth (PBKDF2 + signed cookie) + session middleware

**Files:**
- Create: `apps/worker/src/auth/password.ts`, `session.ts`, `routes.ts`
- Create: `apps/worker/src/http/app.ts`, `middleware.ts`, `errors.ts`
- Create: `apps/worker/src/db/client.ts`
- Create: `apps/worker/scripts/init-admin.ts`
- Create: `apps/worker/tests/auth.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Produces:
  - `hashPassword(password: string): Promise<string>`
  - `verifyPassword(password: string, hash: string): Promise<boolean>`
  - `createSessionCookie(userId: string, secret: string): string`
  - `readSession(cookieHeader: string | null, secret: string): { userId: string } | null`
  - Routes: `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password`, `GET /api/auth/me`
  - `pnpm --filter @mankr/worker exec tsx scripts/init-admin.ts` (or wrangler d1 execute helper)

- [ ] **Step 1: Write failing auth unit tests**

`apps/worker/tests/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password'
import { createSessionCookie, readSession } from '../src/auth/session'

describe('password', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct-horse')
    expect(await verifyPassword('correct-horse', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('session', () => {
  it('round-trips signed cookie', async () => {
    const cookie = await createSessionCookie('user-1', 'test-secret-at-least-32-chars!!')
    const session = await readSession(`mankr_session=${cookie}`, 'test-secret-at-least-32-chars!!')
    expect(session).toEqual({ userId: 'user-1' })
  })

  it('rejects tampered cookie', async () => {
    const cookie = await createSessionCookie('user-1', 'test-secret-at-least-32-chars!!')
    const session = await readSession(`mankr_session=${cookie}x`, 'test-secret-at-least-32-chars!!')
    expect(session).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @mankr/worker test
```

Expected: FAIL module not found / cannot resolve.

- [ ] **Step 3: Implement password + session**

`password.ts` — WebCrypto PBKDF2-SHA-256, 100_000 iterations, format `pbkdf2$iterations$saltB64$hashB64`.

`session.ts` — HMAC-SHA-256 over `userId.exp`, cookie name `mankr_session`, HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d. Export `Set-Cookie` builders for login/logout.

- [ ] **Step 4: Implement Hono app + auth routes**

- Login body `{ username, password }` → 401 if invalid; else Set-Cookie.
- Logout clears cookie.
- Password change requires session + `{ currentPassword, newPassword }` (min 8).
- `GET /api/auth/me` returns `{ username, displayName }` or 401.
- All `/api/*` except login require session middleware → 401 `{ error: 'unauthorized' }`.

Wire `index.ts` `fetch` to Hono; non-`/api` → `env.ASSETS.fetch`.

- [ ] **Step 5: Init admin script**

Script args via env: `ADMIN_USERNAME`, `ADMIN_PASSWORD`. Insert single `users` row if none exists; refuse if user already present. Document usage with `wrangler d1 execute` or local script against D1.

Also add root script:
```json
"init:admin": "wrangler d1 execute mankr-mail --local --command \"...\""
```
Prefer a small worker-side approach: `POST /api/setup` **only when users table empty**, body `{ username, password, displayName? }` — simpler for one-click. Guard: if any user exists → 403. Document this as the init path.

Choose **empty-DB bootstrap endpoint** `POST /api/setup` (unguarded only when `COUNT(users)=0`).

- [ ] **Step 6: Run tests — expect PASS; commit**

```bash
pnpm --filter @mankr/worker test
git add -A && git commit -m "feat: add session auth and bootstrap setup"
```

---

### Task 3: Aliases API (max 5, default sender)

**Files:**
- Create: `apps/worker/src/aliases/routes.ts`, `service.ts`
- Create: `apps/worker/tests/aliases.test.ts`
- Modify: `apps/worker/src/http/app.ts`

**Interfaces:**
- Produces:
  - `GET /api/aliases` → `{ aliases: Alias[] }`
  - `POST /api/aliases` → `{ address: string }` (local-part or full; normalize to `local@EMAIL_DOMAIN`)
  - `PATCH /api/aliases/:id` → `{ enabled?: boolean, isDefault?: boolean }`
  - Reject create when count ≥ 5 with `{ error: 'alias_limit', message: '...' }`

- [ ] **Step 1: Write service tests for limit + default uniqueness**

Test pure functions:
- `normalizeAddress(localOrFull, domain)`
- `assertCanCreate(count)` throws / returns error when count >= 5
- Setting `isDefault=true` clears previous default

- [ ] **Step 2: Implement service + routes; wire Hono**

Rules:
- Address must end with `@${EMAIL_DOMAIN}` after normalize.
- First created alias auto-default if none.
- Cannot disable the only enabled alias if that would leave zero enabled (optional soft rule — prefer allow disable all; inbound simply drops).
- Max 5 hard.

- [ ] **Step 3: Test + commit**

```bash
pnpm --filter @mankr/worker test
git add -A && git commit -m "feat: add alias CRUD with free-tier limit of 5"
```

---

### Task 4: Messages API (list, detail, read, trash, restore, empty)

**Files:**
- Create: `apps/worker/src/messages/routes.ts`, `service.ts`
- Create: `apps/worker/tests/messages.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/messages?folder=inbox|sent|trash&limit=&cursor=`
  - `GET /api/messages/:id`
  - `POST /api/messages/:id/read`
  - `POST /api/messages/:id/trash`
  - `POST /api/messages/:id/restore` (trash → inbox or sent based on direction)
  - `DELETE /api/messages/trash` (physical delete all trash)

List item shape:
```ts
type MessageListItem = {
  id: string
  folder: 'inbox' | 'sent' | 'trash'
  fromAddr: string
  toAddrs: string[]
  subject: string
  isRead: boolean
  hasUnsupportedAttachments: boolean
  createdAt: number
}
```

Detail includes `textBody`, `htmlBody`, `aliasId`, `direction`, `lastErrorCode`.

- [ ] **Step 1: Implement service with D1 queries + tests for restore folder mapping**
- [ ] **Step 2: Wire routes; unauthorized without cookie**
- [ ] **Step 3: Test + commit**

```bash
git commit -m "feat: add mailbox message list and folder actions"
```

---

### Task 5: Inbound Email Routing handler

**Files:**
- Create: `apps/worker/src/inbound/handler.ts`, `parse.ts`
- Create: `apps/worker/tests/inbound.test.ts`
- Modify: `apps/worker/src/index.ts` `email` export

**Interfaces:**
- Consumes: `aliases` enabled lookup; `messages` insert
- Produces: `handleInboundEmail(message, env): Promise<void>`

Flow:
1. Parse `message.to` → match enabled alias (case-insensitive).
2. No match → `setReject('Unknown address')` or silently accept&drop (prefer **accept and drop** to avoid bounce noise — document choice: **drop without reject** using early return after reading stream, or `setReject`). Spec: 「不入库」. Use early return without reject to reduce backscatter; do not forward.
3. Parse MIME via `postalmime` from `await new Response(message.raw).arrayBuffer()`.
4. Extract text/html; if attachments present set `has_unsupported_attachments=1`.
5. Insert `folder=inbox`, `direction=inbound`, `is_read=0`.

- [ ] **Step 1: Unit-test MIME fixture parsing (multipart text+html+attachment flag)**
- [ ] **Step 2: Implement handler; wire `email` export**
- [ ] **Step 3: Add `apps/worker/tests/fixtures/sample.eml` minimal**
- [ ] **Step 4: Test + commit**

```bash
git commit -m "feat: ingest Email Routing messages into D1 inbox"
```

---

### Task 6: Send adapters + send API

**Files:**
- Create: `apps/worker/src/adapters/send/types.ts`, `cloudflare.ts`, `resend.ts`, `mailchannels.ts`, `index.ts`
- Create: `apps/worker/src/send/routes.ts`, `rate-limit.ts`
- Create: `apps/worker/tests/send-adapter.test.ts`

**Interfaces:**
```ts
export type SendErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'invalid_address'
  | 'provider_error'

export interface SendAdapter {
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

- `getSendAdapter(env): SendAdapter` switches on `SEND_CHANNEL`.
- **cloudflare:** `env.EMAIL.send({ from, to, subject, text, html, replyTo })`; missing binding → `not_configured`. Map provider throws to `provider_error` / `invalid_address`.
- **resend:** `POST https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`; no key → `not_configured`.
- **mailchannels:** Workers-compatible free path or API key if required; no config → `not_configured`. Prefer documented MailChannels Workers API if still free; else thin HTTP wrapper.
- Rate limit: in-memory / D1 counter per day per mailbox — simple D1 table optional; V1 OK with approximate in-isolate Map + 30/hour soft limit returning `rate_limited`.

`POST /api/messages/send` body:
```ts
{
  fromAliasId: string
  to: string[]
  subject: string
  text: string
  html?: string
  replyToMessageId?: string
}
```

Rules:
- Auth required; `from` alias must be enabled and owned.
- On success: insert `folder=sent`, `direction=outbound`, store `provider_message_id`.
- On failure: **do not** insert sent; return `{ error: SendErrorCode, message: string }` with HTTP 400/429/502 mapping.

- [ ] **Step 1: Adapter unit tests with mocked fetch / EMAIL binding**
- [ ] **Step 2: Implement adapters + send route**
- [ ] **Step 3: Test + commit**

```bash
git commit -m "feat: add pluggable send adapters and compose API"
```

---

### Task 7: Web app — shadcn preset init + shell layout

**Files:**
- Create/replace: `apps/web/**` via shadcn vite template + preset
- Create: `apps/web/vite.config.ts` proxy `/api` → `http://127.0.0.1:8787`
- Create: `apps/web/src/lib/api.ts`, `sanitize.ts`
- Create: `apps/web/src/App.tsx` routes shell

- [ ] **Step 1: Init shadcn in apps/web**

```bash
cd apps/web
# If placeholder conflicts, remove placeholder files first keeping package name @mankr/web
pnpm dlx shadcn@latest init --preset b39gyV42i --template vite
```

Ensure package name remains `@mankr/web`. Add deps:
```bash
pnpm --filter @mankr/web add react-router @phosphor-icons/react react-hook-form @hookform/resolvers zod dompurify
pnpm --filter @mankr/web add -D @types/dompurify
pnpm dlx shadcn@latest add button input label card textarea separator dropdown-menu dialog sheet badge scroll-area sonner form
```
(Run add from `apps/web` cwd.)

- [ ] **Step 2: Configure Vite proxy + path aliases as preset provides**

```ts
server: {
  proxy: {
    '/api': 'http://127.0.0.1:8787',
  },
},
```

- [ ] **Step 3: `api.ts` thin fetch wrapper**

```ts
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.message || res.statusText), { status: res.status, body })
  }
  if (res.status === 204) return undefined as T
  return res.json()
}
```

`sanitize.ts`: `DOMPurify.sanitize(html)`.

- [ ] **Step 4: App shell routes**

| Path | Page |
|------|------|
| `/login` | Login |
| `/setup` | Bootstrap (only useful when no user) |
| `/` | Redirect → `/inbox` |
| `/inbox`, `/sent`, `/trash` | Mailbox |
| `/m/:id` | Message detail |
| `/compose` | Compose (`?reply=` optional) |
| `/aliases` | Alias management |

Layout: left nav folders + aliases link; main outlet. Auth gate: call `/api/auth/me` on load.

- [ ] **Step 5: Build empty shell; commit**

```bash
pnpm --filter @mankr/web build
git commit -m "feat: init web app with shadcn preset and app shell"
```

---

### Task 8: Web — auth, aliases, mailbox, read, compose UI

**Files:**
- Create: `apps/web/src/features/auth/*`, `aliases/*`, `mailbox/*`, `message/*`, `compose/*`

**Requirements (map PRD P0):**
1. Login / logout / change password (dialog or `/aliases` adjacent settings strip — password dialog on layout menu is enough for P0).
2. Aliases: list, create (show remaining slots), enable/disable, set default; show limit messaging.
3. Folder lists: subject, from, time, unread weight; click → detail.
4. Detail: sanitize HTML; show attachment-unsupported banner; actions trash/restore/reply.
5. Compose: from alias select (default alias), to, subject, text textarea; submit shows SendErrorCode toasts.
6. Reply: prefill to=original from, fromAlias=receiving alias, subject=`Re: …`, quote text body.
7. Empty trash button on trash folder.
8. Visible free-tier boundaries: short note in aliases page + README.

- [ ] **Step 1: Implement auth pages + session gate**
- [ ] **Step 2: Implement aliases page**
- [ ] **Step 3: Implement mailbox list + detail**
- [ ] **Step 4: Implement compose + reply**
- [ ] **Step 5: Manual smoke with `pnpm dev` (API stub data via local D1 seed)**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: ship P0 web client for mail and aliases"
```

---

### Task 9: Deploy docs + README + one-click path

**Files:**
- Create: `README.md`, `docs/DEPLOY.md`
- Modify: `wrangler.toml` comments; optional `deploy.button` / Cloudflare dashboard link instructions

**Deploy doc MUST include:**
1. Prerequisites: Cloudflare account, domain on CF DNS, Node ≥22.12, pnpm via Corepack.
2. One-click: Deploy to Cloudflare button (Workers) pointing at this repo; after deploy set secrets `COOKIES_SECRET`, optional `RESEND_API_KEY`.
3. Manual: `pnpm install && pnpm db:migrate:remote && pnpm deploy`.
4. Post-deploy checklist:
   - Set `EMAIL_DOMAIN`, `SEND_CHANNEL`
   - Email Routing → catch-all or per-alias → Worker
   - Open `/setup` create admin
   - Create aliases ≤5
   - Send test inbound; reply; check Sent
5. **Total Free send note:** Cloudflare arbitrary outbound needs Paid; use `SEND_CHANNEL=resend` + free Resend API key for zero-card arbitrary send.
6. Capability boundaries: 5 aliases, no attachments, single user/domain.

- [ ] **Step 1: Write README + DEPLOY**
- [ ] **Step 2: Ensure `pnpm build` succeeds end-to-end**
- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add deploy guide and Total Free send channel notes"
```

---

### Task 10: End-to-end verification checklist

- [ ] **Step 1: Local verify**

```bash
pnpm install
pnpm db:migrate:local
# seed via POST /api/setup
pnpm dev
```

Checklist:
- [ ] setup → login → logout → login
- [ ] change password
- [ ] create 5 aliases; 6th rejected
- [ ] insert mock inbound row (SQL or fixture handler test) → appears in inbox
- [ ] read marks read; HTML sanitized
- [ ] send with `SEND_CHANNEL=resend` mocked or `not_configured` error visible
- [ ] trash / restore / empty
- [ ] unauthenticated `/api/messages` → 401

- [ ] **Step 2: Fix any gaps found**
- [ ] **Step 3: Final commit if needed**

```bash
git commit -m "fix: close verification gaps for P0 mail loop"
```

---

## Spec Coverage Self-Check

| PRD / Arch requirement | Task |
|------------------------|------|
| Login/logout/password | 2, 8 |
| Aliases ≤5 + default | 3, 8 |
| Inbound to enabled aliases | 5 |
| Inbox list/read | 4, 8 |
| Send/reply + sent | 6, 8 |
| Trash/restore/empty | 4, 8 |
| One-click + docs | 1, 9 |
| Total Free boundaries | 6, 9 |
| Send adapter pluggable | 6 |
| shadcn preset | 7 |
| Workers monolith + D1 | 1 |

## Placeholder Scan

No TBD steps; Free-tier Cloudflare send limitation explicitly handled via Resend path in Tasks 6 & 9.

## Type Consistency

- Folders: `inbox | sent | trash`
- `SendErrorCode` shared naming in adapter + API + UI toasts
- Cookie name: `mankr_session`
- Bootstrap: `POST /api/setup` when zero users
