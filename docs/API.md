# 项目发信接入 API

其他项目的服务端通过本站 HTTP API 发送验证码、订单通知等邮件。打开 **设置 → 项目接入**（`/settings?tab=apikeys`），可在同一流程里创建邮件地址、创建项目密钥、复制接入示例并查看记录。

## 前置条件与权限

- 一个启用的本站地址，以及活动发信平台的凭证和域名验证。本站支持 Resend / Brevo / Maileroo；设置页显示“已配置凭证”不代表域名已验证或邮件已送达。
- 调用方是服务端。不要把密钥嵌入网页、前端环境变量或公开仓库。接口不提供跨源 CORS 支持。
- 发信使用 `Authorization: Bearer mfp_live_…`，无需管理员 Cookie。项目密钥只能发送邮件，不能创建地址、查询邮箱或读取管理日志。
- 管理接口必须携带已登录的管理员 Cookie。只带项目 Bearer 密钥仍返回 `401`。
- HTTP 密钥不是 SMTP 密码。当前 SMTP **待配置**，不新增服务器，也未开通 Cloudflare 付费能力。

## 发送邮件

`POST /api/v1/send`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `to` | `string[]` | 是 | 1–10 个邮箱地址 |
| `subject` | `string` | 是 | 最长 998 字符，可为空 |
| `text` | `string` | 是 | 最长 100000 字符，可为空 |
| `html` | `string` | 否 | 最长 100000 字符 |
| `replyTo` | `string` | 否 | 回复邮箱地址 |

不支持附件。发件人固定为密钥绑定地址，传入 `from` 不会覆盖它。密钥不存在、已停用、或绑定地址已停用，均返回相同的 `401 unauthorized`。

在项目服务端设置环境变量（示例中的幂等键必须替换成真实业务事件 ID）：

```dotenv
MANKR_MAIL_API_URL=https://YOUR_WORKER_HOST/api/v1/send
MANKR_MAIL_API_KEY=replace_with_your_project_key
```

环境文件由项目运行环境载入。shell 执行 curl 前需导出变量；Python 示例需安装 `requests`，PHP 需启用 curl 扩展。

```bash
curl "$MANKR_MAIL_API_URL" \
  -H "Authorization: Bearer $MANKR_MAIL_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123-confirmation" \
  -d '{"to":["user@example.com"],"subject":"Order confirmed","text":"Thank you"}'
```

```js
const response = await fetch(process.env.MANKR_MAIL_API_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.MANKR_MAIL_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "order-123-confirmation",
  },
  body: JSON.stringify({
    to: ["user@example.com"], subject: "Order confirmed", text: "Thank you",
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));
console.log(result.id);
```

```python
import os
import requests

response = requests.post(os.environ["MANKR_MAIL_API_URL"],
    headers={
        "Authorization": "Bearer " + os.environ["MANKR_MAIL_API_KEY"],
        "Idempotency-Key": "order-123-confirmation",
    },
    json={"to": ["user@example.com"], "subject": "Order confirmed", "text": "Thank you"},
    timeout=45,
)
print(response.status_code, response.json())
```

```php
<?php
$ch = curl_init(getenv('MANKR_MAIL_API_URL'));
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 45,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('MANKR_MAIL_API_KEY'),
    'Content-Type: application/json',
    'Idempotency-Key: order-123-confirmation',
  ],
  CURLOPT_POSTFIELDS => json_encode([
    'to' => ['user@example.com'], 'subject' => 'Order confirmed', 'text' => 'Thank you',
  ]),
]);
$result = curl_exec($ch);
if ($result === false) throw new RuntimeException(curl_error($ch));
echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . " " . $result;
curl_close($ch);
```

成功返回 `201`：

```json
{ "id": "log-uuid", "providerMessageId": null }
```

`id` 是本站日志 ID，`providerMessageId` 可为空。成功仅说明**平台已接受**，不是送达保证。业务邮件不会写入 Web 的“已发送”，元数据在“项目接入 → 发送记录”查看，不保存正文。

## 幂等与结果未知

可选请求头 `Idempotency-Key`：1–128 个可见 ASCII 字符（不含空格）。不带此头的旧客户端仍可使用原有接口，但本站不会为其重试去重。

- 作用域是单把项目密钥，窗口从首次认领起 **24 小时**。同一业务事件重试必须保留原键和相同内容。
- 有效期内已接受的请求重复调用，返回同一次 `201` 和原日志 ID，并带 `Idempotent-Replayed: true`，不会重复发送或记账。鉴权仍需通过；已停用的密钥不能重放。
- 同键但收件人、主题、正文或 Reply-To 不同，返回 `409 idempotency_conflict`。
- 同键正在处理，返回 `409 request_in_progress` 和 `Retry-After: 5`。超过两分钟仍未完成会保守返回未知，不自动重发。
- 已明确失败的请求保留原错误；修正配置或输入后，只有确认未发送才应使用新业务键。
- 网络异常、平台 5xx 等无法确认接受结果时返回 `502`，包含 `state: "unknown"`、`retryable: false`、`requestId`。同键重试不会再次调用平台。
- 平台已接受但本站批量写入失败，同样返回未知。先核查平台记录和收件箱，不能因 HTTP 错误换键自动重发或切换平台。
- 24 小时后允许原子认领为新请求，可能再次发送。不要用过期键重新提交结果不明的旧邮件。
- 本站只保存键/规范化内容的 SHA-256 和处理元数据，不保存正文；旧记录超过 48 小时后在后续成功的幂等发送中每次最多清理 100 条。有效期判断不依赖清理任务。

这不构成无限期 exactly-once 保证。Resend 同时透传由本站请求 ID 派生的上游幂等键，参考 [Resend 官方说明](https://resend.com/docs/dashboard/emails/idempotency-keys)；Brevo/Maileroo 不承诺相同上游能力。服务中断留下的处理记录保持保守语义。

## 错误契约

| HTTP | `error` | 含义 |
| --- | --- | --- |
| 401 | `unauthorized` | 缺少、无效或停用的密钥，或其地址已停用 |
| 400 | `invalid_address` | 请求 JSON/字段、地址或收件人数无效 |
| 400 | `invalid_idempotency_key` | 幂等头格式错误 |
| 409 | `idempotency_conflict` | 有效期内相同键对应不同内容 |
| 409 | `request_in_progress` | 同键处理中，稍后查询相同请求 |
| 429 | `quota_exceeded` | 本站项目密钥额度已满 |
| 502 | `not_configured` | 未配置活动发信平台凭证 |
| 502 | `provider_error` | 平台错误；检查是否同时返回未知状态 |

旧错误继续包含 `error` / `message`；409 响应含 `error` / `requestId`。未知响应示例：

```json
{"error":"provider_error","message":"Acceptance is unknown. Check the provider before sending again.","state":"unknown","retryable":false,"requestId":"request-uuid"}
```

## 配额、日志与生命周期

每把密钥默认每小时 30、每日 200，允许编辑为 1–10000。每日按近 24 个小时窗口计数。额度按**平台接受的请求次数**计，一次多收件人请求计 1 次；平台共享用量按收件人数计算。检查和累加并非原子预留，并发下可能略超，是软限制而非费用硬上限。平台用量和数据时间见“用量”页面。

日志保留最近 30 天，只包含项目名/密钥前缀、地址、主题、状态、错误和平台 ID。`sent` 显示“平台已接受”，`failed` 中的 `outcome_unknown` 表示结果未知。上游调用前的 401/400/429 不写逐封日志；`failed` 聚合包含未知结果，调用项目应保存自己的错误响应。

秘密只在创建响应中返回一次，数据库仅保存哈希。响应丢失后不能恢复明文：核对密钥列表、停用未拿到秘密的密钥，再重新创建。地址已创建而密钥创建失败时，地址保留，可继续使用。

轮换顺序：创建新密钥 → 在项目更新并验证 → 停用旧密钥以保留历史 → 确认无流量后再删除。删除会级联清除该密钥的日志、额度与幂等记录。不同密钥独立计数。停用地址同时阻止该地址的后续收信和全部绑定密钥的新鉴权请求，不承诺撤回在途请求。

## 管理接口（管理员 Cookie）

- `GET /api/integration-capabilities`：`domain`；`aliases`/`apiKeys` 的 `limit, used, remaining`；`outbound.provider/configured/domainVerified`；`inbound.status`；`smtp.mode`。别名的 `limit` 和 `remaining` 为 `null`，表示应用未设置数量上限；`used` 仍是已创建总数。不返回秘密，目前域名验证未知、收信未验证、SMTP 未配置。
- `GET /api/aliases`：地址列表。
- `POST /api/aliases`：新流程用 `{ "localPart": "orders" }`；保留旧 `{ "address": "orders@example.com" }`。两字段互斥。新字段只接受 1–64 字符、字母数字开头/结尾、中间允许 `. _ + -`、不允许连续点，不接受 `@`。旧字段保留既有归一化语义，会按 `EMAIL_DOMAIN` 重写域名。成功均返回完整 `{ id, address, enabled, isDefault, createdAt }`（旧客户端仍能读取 `address`）。
- `PATCH /api/aliases/:id`：`{ enabled?, isDefault? }`。
- `GET /api/api-keys`：密钥列表、绑定地址及 24h/7d 使用聚合，不返回完整密钥。
- `POST /api/api-keys`：`{ name, aliasId, hourlyLimit?, dailyLimit? }`，响应含一次性 `secret`；不能新建到停用地址。
- `PATCH /api/api-keys/:id`：`{ name?, enabled?, hourlyLimit?, dailyLimit? }`，不能改变绑定地址。
- `DELETE /api/api-keys/:id`：删除及级联清理，返回 204。
- `GET /api/api-send-logs?apiKeyId=&status=&cursor=&limit=`：只读分页。`status` 取 `sent`/`failed`；`limit` 默认 25、范围 1–100。按 `created_at DESC, id DESC` 排序。响应 `{ logs: [...], nextCursor: string | null }`；游标必须原样传入。日志实体包含 `id, apiKeyId, projectName, keyPrefix, fromAddr, toAddrs, subject, status, errorCode, providerMessageId, createdAt`。时间为毫秒。

应用不限制别名数量，项目密钥仍限制 20 把。别名共用同一个登录账号。Cloudflare Catch-all 指向本 Worker 后，新启用的别名可接收邮件；逐地址路由需额外添加对应规则。实际发信仍需要服务商授权发信域名或地址。
