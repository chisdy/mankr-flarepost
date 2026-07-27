# 对外发信 API

供其他站点的**服务端**通过 API Key 发送业务邮件（验证码、订单通知等）。密钥在 Web 设置页创建与管理。

## 前置条件

1. 至少有一个已启用的别名（发件地址）
2. 已配置 Secret `RESEND_API_KEY`，且发信域已在 Resend 侧验证（外发统一走 Resend）
3. 调用方必须是服务端；V1 **不发送 CORS 头**，浏览器直调会被同源策略拦截

## 鉴权

```http
Authorization: Bearer mfp_live_…
```

密钥明文仅在创建时展示一次，服务端只存 SHA-256。  
「密钥不存在 / 已禁用 / 绑定别名已禁用」均返回相同的 `401 unauthorized`，避免枚举。

## 发送邮件

`POST /api/v1/send`

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `to` | `string[]` | 是 | 收件人，1–10 个 |
| `subject` | `string` | 是 | 主题 |
| `text` | `string` | 是 | 纯文本正文 |
| `html` | `string` | 否 | HTML 正文 |
| `replyTo` | `string` | 否 | Reply-To 地址 |

不支持附件。发件人固定为密钥绑定的别名。

### curl

```bash
curl -sS -X POST "https://YOUR_WORKER_HOST/api/v1/send" \
  -H "Authorization: Bearer mfp_live_…" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["user@example.com"],
    "subject": "Your code",
    "text": "Your verification code is 123456",
    "html": "<p>Your verification code is <strong>123456</strong></p>"
  }'
```

### Node.js

```js
const res = await fetch("https://YOUR_WORKER_HOST/api/v1/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.MANKR_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    to: ["user@example.com"],
    subject: "Your code",
    text: "Your verification code is 123456",
  }),
})
if (!res.ok) {
  const err = await res.json()
  throw new Error(`${err.error}: ${err.message}`)
}
const { id, providerMessageId } = await res.json()
```

### 成功响应 `201`

```json
{ "id": "log-uuid", "providerMessageId": "re_…" }
```

`id` 是本系统的发送日志 id；`providerMessageId` 来自上游（如 Resend）。

业务邮件**不会**写入 Web 端「已发送」。元数据写入 `api_send_logs`（收件人 / 主题 / 状态 / 时间），保留约 **30 天**，发送时顺带清理过期行。

## 错误码

| HTTP | `error` | 含义 |
|------|---------|------|
| 401 | `unauthorized` | 缺少 / 无效 / 已禁用的密钥，或绑定别名已禁用 |
| 400 | `invalid_address` | 请求体不合法、收件人超限或地址无效 |
| 429 | `quota_exceeded` | 超过该密钥的每小时或每日上限 |
| 502 | `not_configured` | 未配置发信渠道（常见于未设 Resend） |
| 502 | `provider_error` | 上游发信失败 |

响应体形状：`{ "error": "…", "message": "…" }`。

## 配额（软限制）

每把密钥可单独设置：

- 每小时上限（默认 30）
- 每日上限（默认 200，按近 24 个小时窗口合计）

`check` 与 `increment` 不是原子操作，高并发下可能略微超发——与 Web 端发信的软限流语义一致。请勿当作硬上限依赖。

## 密钥轮换

1. 创建一把新密钥，把新密钥部署到站点
2. 确认新密钥可用后，在设置里**停用**旧密钥（保留日志）
3. 确认无流量后，再删除旧密钥（会级联删除其发送日志）

管理 API（需登录 Cookie）：

- `GET /api/api-keys`
- `POST /api/api-keys` — body: `{ name, aliasId, hourlyLimit?, dailyLimit? }`，响应含一次性 `secret`
- `PATCH /api/api-keys/:id` — `{ name?, enabled?, hourlyLimit?, dailyLimit? }`
- `DELETE /api/api-keys/:id`

## 浏览器直调（未实现）

V1 仅服务端。若以后需要静态站直调，再为密钥增加 `allowed_origins` 并处理 CORS / `OPTIONS`。
