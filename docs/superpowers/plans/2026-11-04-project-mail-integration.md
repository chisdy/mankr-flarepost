# 其他项目发信接入与站内创建地址计划

## 实施决策更新（2026-11-04）

用户已明确要求根据本文档实施，并选择：**暂不接受 Workers Paid 与 Cloudflare 独立管理 SMTP，SMTP 保持待配置并注明限制**。因此本次执行范围为 S0–S5/S7 的地址管理、HTTP 项目接入、日志和重试保护；S6 的原生 SMTP 开通及真实 SMTP 项目验收按用户决定延期，不显示可用，不引入服务器或付费服务。

本地实现与验收进度另记于 `docs/project-integration-implementation-2026-11-04.md`。原评审结论保留下文作为决策依据；其“尚未实施”“下一步先决策”描述是评审时点状态，以本更新和实施记录为准。真实 HTTP 投递和外部回复验收需用户提供测试环境和授权收件邮箱，不能用本地模拟替代。


日期：2026-11-04。状态：评审完成；HTTP 与地址管理已补齐执行步骤，SMTP 存在两项阻塞，尚未实施。

## 问题与边界

让管理员在本站现有域名下方便地创建新的邮件地址，并让其他项目使用独立凭证从这些地址发送邮件，能在本站确认配置、查看结果和管理停用。

默认继续单管理员、单域名；“新邮件地址”指该域名下的收发别名，不是独立登录账号。本轮仅评审并写计划。

**用户已明确的约束（补充于评审）：** HTTP API 与 SMTP 两种接入都需要；只部署在 Cloudflare，不增加 VPS、容器或 SMTP 网关。不能将 SMTP 网关列入执行方案。沿用原项目免费优先的默认原则，但用户尚未决定是否接受 Cloudflare 原生 SMTP 的付费前提，也尚未接受其凭证、停用与日志边界。

本文作为上述专项的后续计划；上一份全面拓展分析仍是候选功能清单，其通用客户端优先级不作为本专项的执行顺序。

## 初始计划（评审输入，不作为最终执行顺序）

1. 复用已有别名和 API Key 功能，提供“为项目接入发信”的集中入口。
2. 引导管理员选择已有地址或创建新地址，为项目创建独立 Key 和发送配额。
3. 生成项目接入配置、HTTP 调用示例和接入检查说明。
4. 提供发送记录与失败提示，支持停用凭证和地址。
5. 验证地址创建、项目发信、日志查看和停用全过程。

## 初始变更集

- 前端：`apps/web/src/features/settings/aliases-settings.tsx`、`api-keys-settings.tsx`、`settings-view.tsx`、`apps/web/src/lib/types.ts`、`apps/web/src/i18n/locales/en.json`、`zh-CN.json`；新增项目接入引导和日志组件。
- 后端：`apps/worker/src/aliases/routes.ts`、`aliases/service.ts`、`api-keys/routes.ts`、`api-keys/service.ts`、`api-keys/quota.ts`、`send/public-routes.ts`、`http/middleware.ts`；按需要新增管理路由。
- 共享契约：`adapters/send/types.ts`、`adapters/send/{resend,brevo,maileroo}.ts`；是否变更由评审确认。
- 数据：现有 `aliases`、`api_keys`、`api_key_usage`、`api_send_logs`，如需要新增字段或实体，先明确迁移和回填。
- 端点：现有 `/api/aliases`、`/api/api-keys`、`POST /api/v1/send`；拟增加仅管理员可读的发送记录接口。
- 配置：复用 `EMAIL_DOMAIN`、`SEND_PROVIDER`、`COOKIES_SECRET` 与现有平台密钥；暂不新增必填 Secret。
- 验证与文档：aliases/api-keys/public-send/send-adapter/send-providers/usage 等相关测试、`docs/API.md`、`README.md`、部署说明。

## 评审记录与修订计划

### 1. 结论与最终产品方向

结论：**需补齐 10 项，其中 2 项阻塞；必须补齐已回写以下步骤，SMTP 两项产品/部署约束尚未解除，不能将整个方案标记为可以开工。** HTTP 与站内创建地址可以独立交付；它们完成不代表 SMTP 需求完成。

项目语境：已有相关业务实现，按稳定契约保护；不代表已审计生产稳定性。

产品目标收敛为：**个人项目的邮件接入管理台**，同一站点负责地址配置、独立发信凭证、接入指引、结果查询。建议入口直接叫“项目接入”，地址管理叫“邮件地址”，在解释文案中注明地址属于同一管理员，避免要求用户先理解别名/API Key 才能使用。

第一版“项目”是现有 API Key 的用途名称，不新建 projects 表，不宣称具备多凭证聚合的项目总配额。一个项目可持有多把 Key 用于轮换，但各 Key 仍独立计数；列表同时显示 Key 前缀以区分同名记录。真正的项目实体与项目级共享配额待有需求再设计。

理想操作流程：

```text
项目接入 → 新建接入 → 填项目名 → 选择已有地址 / 创建新地址
         → 查看接收状态与发信前提 → 设置该 Key 配额
         → 生成一次性 HTTP 凭证与配置 → 用真实项目完成测试
         → 查看发送记录 / 编辑配额 / 轮换或停用

SMTP：同页独立能力卡 → 显示是否启用、部署条件、外部凭证边界
      → 只有方案条件已满足，才显示可用的真实 SMTP 配置
```

### 2. 平台约束与 SMTP 阻塞

本次按 2026-11-04 可见的官方文档核查：

1. Worker 的 connect handler 支持其他 Worker 通过 service binding 转发的连接，**不支持来自公网的任意直接 TCP 连接**。不能在当前 Worker 增加一个监听 465/587 的 SMTP 服务，也不能把 HTTPS URL 当作 SMTP Host。[Workers connect handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/connect/)
2. Cloudflare Email Service 有原生 SMTP，端点为 `smtp.mx.cloudflare.net:465`，隐式 TLS，用户名 `api_token`，密码为具有 Email Sending: Edit 权限的 Cloudflare API Token。它不是本站 `mfp_live_…` Key；官方提示该凭证可用于匹配账号下已接入的域名，不能按本站 alias_id 推断其授权边界。[Cloudflare SMTP](https://developers.cloudflare.com/email-service/api/send-emails/smtp/)
3. 原生向任意收件人发送要求 Workers Paid；向账号已验证目的地址免费不等于能免费发送验证码给任意用户。[Cloudflare Email Service 定价](https://developers.cloudflare.com/email-service/platform/pricing/)

**R1 [阻塞] 拓扑前提未满足：** 原计划复用 HTTP API 不能提供 SMTP 监听。在只部署 Cloudflare 的约束下，候选路径是 Cloudflare 原生 SMTP，但须先确认能开通及付费条件；如果仍要求免费、不增加服务、SMTP 也必须经过本站统一授权，则当前方案不可交付。

**R2 [阻塞] 统一控制前提不成立：** 其他项目直连原生 SMTP，会绕过本站 requireApiKey、配额与 api_send_logs。本站停用 Key/地址不能据此撤销 Cloudflare Token，也不能直接承诺 SMTP 发信已被阻止。不把“提供 SMTP 参数”视为完成“本站统一管控”。必须先在以下语义中选择：

- **托管 SMTP 模式候选：** 本站生成配置与开通指引，SMTP 由 Cloudflare 授权、撤销和统计；界面明确分开，且只给用户控制的可信项目配置专用最小权限 Token，不分发当前应用/部署/分析主 Token。
- **本站统一管控模式：** HTTP 与 SMTP 都必须使用本站按地址绑定的凭证、统一停用、按 Key 限额与本站逐封日志。基于已核查的接口，没有证明能在现有 Cloudflare-only 部署中实现，不能作为本期承诺；需平台能力变化或重新决定部署约束。

不同项目使用不同 Cloudflare Token 有利于分别撤销，但并不能证明这些 Token 只允许某个发件地址。若用户要求地址级硬隔离，候选的托管 SMTP 模式也不能按现有证据验收。不能仅在 SMTP 配置中预填 From 就宣称隔离成立。

已有 Resend/Brevo/Maileroo 平台的直连 SMTP 可在“允许现有平台承载 SMTP”的范围内另行评估；它同样绕过本站控制，因此本期不默认改走此路径，也不认为这能解除 R2。

### 3. 已核对的前提与真实状态

| 前提 | 核对结果与证据 |
| --- | --- |
| 本站尚不能被其他项目调用发信 | 不成立；已有 `POST /api/v1/send`，Bearer-only，见 `apps/worker/src/send/public-routes.ts:65`、`http/app.ts:23` |
| 本站尚不能创建地址 | 不成立；已有 `POST /api/aliases` 和设置页创建表单，见 `aliases/routes.ts:21`、前端 `aliases-settings.tsx:77` |
| 每把 Key 绑定一个地址 | 已确认；api_keys.alias_id NOT NULL，查询关联 aliases；`api-keys/service.ts:138` 附近的 SELECT 与 `0005_api_keys.sql` |
| 新建地址返回完整实体 | 形状不符；只返回 `{address}`，没有后续创建 Key 所需的 id；`aliases/routes.ts:39` |
| 地址创建等于可收发 | 不成立；服务仅写 D1；收信依赖 catch-all/逐地址路由，发信依赖平台域名验证；`docs/DEPLOY.md:239`、`:259`、`:276` |
| 地址与项目数量可任意扩展 | 不成立；后端 MAX_ALIASES=5、前端也写死 5；MAX_API_KEYS=20；`aliases/service.ts:1`、前端 `aliases-settings.tsx:36`、`api-keys/service.ts:5` |
| 可安全接受任意完整邮箱作为新地址 | 不成立；normalizeAddress 会将其他域名改写为 EMAIL_DOMAIN，且现有测试明确约定该行为；`aliases/service.ts:38`、`tests/aliases.test.ts:18` 附近 |
| 地址/Key 停用能阻止本站 API 发信 | 已确认，新请求鉴权同时检查两者；`http/middleware.ts:28`；但不涵盖已通过校验的在途请求或直连 SMTP |
| 有逐封日志可直接复用 | 有日志表与写入，无日志查询路由和逐封 UI；管理页只有 24h/7d 聚合；`api-keys/routes.ts:36`、`api-keys/service.ts:300`、前端 `api-keys-settings.tsx` |
| API 邮件进入 Web 已发送 | 不成立，已有测试要求不写 messages；`tests/public-send.test.ts` 中 success case、`docs/API.md` |
| 配额按收件人数且为硬限制 | 不成立；Key 配额成功请求 +1，为软限制；provider 用量按收件人数；`api-keys/quota.ts:85`、`send/public-routes.ts:140` |
| 可从站内再次取得 Key 明文 | 不成立；仅保存 hash，创建时返回一次；`api-keys/service.ts:187` |
| 删除 Key 后保留日志 | 不成立；FK ON DELETE CASCADE，`api-keys/service.ts:282`、`0005_api_keys.sql` |
| 本地迁移均已到最新 | 未确认；根目录只读检查发现两个业务本地库，一个仅到 0002，另一个到 0007，均未见 0008；未确认当前服务实际使用哪一个，远程迁移未核对 |
| 计划涉及的 UI 当前无其他改动 | 不成立；aliases/api-keys/settings/provider UI、语言文件及 README 已有未提交改动；本轮只写此计划，不覆盖这些文件 |

### 4. 当前问题链与隔离

#### 链 A：站内创建地址并接入 HTTP

`项目接入入口` [原计划已覆盖] → `选择旧地址/创建新地址` [已覆盖] → `域名和数量校验` [漏列，R5] → `D1 创建并返回 id` [漏列，R4] → `收信路由/发信配置状态` [漏列，R3] → `创建 Key 与一次性显示` [已覆盖，部分失败与丢失恢复漏列，R4/R6] → `调用方配置` [已覆盖] → `Bearer + 地址启用校验` [已覆盖] → `配额/幂等/上游提交` [配额语义及未知状态漏列，R7/R8] → `日志与用量` [只有写入被覆盖，查询漏列，R6] → `停用/轮换` [基本入口覆盖，同步影响漏列，R6]。

#### 链 B：SMTP

`其他项目 SMTP 客户端` [用户补充] → `公网 TCP/TLS 入口` [原计划漏列，R1] → `SMTP AUTH 与发件授权` [原计划漏列，R2] → `提交/计费/日志` [原计划漏列，R2] → `停用或撤销凭证` [原计划漏列，R2]。不能用链 A 的测试结果证明链 B 已完成。

#### 链 C：新地址收回复

`外部回复` → `Cloudflare Email Routing` → `handleInboundEmail` → `findEnabledAliasByAddress` → `messages` → `现有收件箱`。原计划只写了地址创建，路由、来信与停用验证漏列，已由 R3/R10 补入。

#### 链外隔离

- `getSendAdapter / SendInput / recordSendStatements` 同时供 Web 写信使用：HTTP 接入改进不能改变已有参数必填性、写信返回值、草稿删除或 Web 已发送流程；第一期不扩充 SendProviderId 枚举。
- `normalizeAddress / createAlias` 供现有地址管理使用：不以本次引导为由悄悄改变完整邮箱改写规则；新引导只接收 local-part，明确固定域名预览，旧入口保持原契约。若要全局改为严格域名匹配，另列变更及迁移兼容。
- `aliases` 还供入站、草稿、默认身份、过滤条件与 Key 使用：新建项目地址不能改动已有默认发件身份；首地址沿用当前自动默认行为。停用影响全部绑定 Key 与接收回复，必须提示。
- `api_send_logs` 供 getUsageByKey 聚合：新日志查询只读，不加入重复发送行、不改变 sent/failed 含义。平台接受与送达状态分开，不改旧统计口径。
- 现有 Bearer-only API 与 Cookie-only 管理权限不交叉：外部项目不获得创建地址、读取邮箱、读取其他 Key 或管理平台 Secret 的权限。
- SMTP 托管分支不复用现有 COOKIES_SECRET、部署 Token、分析 Token 或活动平台主密钥作为项目密码；不默认改变当前 Web 活动发信渠道。

### 5. 必须补齐与排序

| ID | 严重度 | 必须补齐项 | 写回步骤 |
| --- | --- | --- | --- |
| R1 | 阻塞 | SMTP 入口/开通条件；不能在 Worker 里监听公网 SMTP，也不能默认引入网关或付费 | S0、S6 |
| R2 | 阻塞 | 直连 SMTP 不受本站 Key、地址、额度或日志控制；必须明确托管/统一管控语义与可信项目范围 | S0、S6、S7 |
| R3 | 重要 | 分开地址已创建、收信待验证、发信已配置/待验证；catch-all 与逐地址路由不能混为一谈 | S1、S3、S7 |
| R4 | 重要 | 创建响应缺 id，跨步失败、Key 一次性明文、父级地址状态同步和默认身份行为未覆盖 | S1、S2、S3 |
| R5 | 重要 | 数量双端写死、Key 上限、并发创建与域名改写语义未覆盖；不能显示“无限创建” | S1、S2 |
| R6 | 重要 | 缺逐封日志读取；删除级联、轮换/丢失恢复、编辑配额和停用范围未覆盖 | S3、S4、S7 |
| R7 | 重要 | 上游已接受但本地写入/响应失败会导致重复重试；缺幂等和未知状态说明 | S5、S7 |
| R8 | 重要 | 每 Key 请求配额、平台收件人数与直连 SMTP 用量不同；不能误称项目硬总额 | S4、S5、S6 |
| R9 | 重要 | 当前 UI 已有未提交工作，本地库迁移不一致；不能按干净文件和最新 schema 开工 | S0、S7 |
| R10 | 重要 | 初稿验收笼统，没有覆盖 HTTP/SMTP 两个真实项目、授权隔离、收回复和不可用状态 | S7 |

### 6. 修订执行步骤（均为补充于评审）

#### S0：固定实施基线与 SMTP 决策门槛

先记录当前 diff 的实际改动，实施时在这些文件上最小增量编辑，不覆盖或回退用户界面工作。确认本次实际开发/部署库及 0001–0008 的执行记录；只读预检，不在本次评审运行迁移或部署。

将 R1/R2 的约束交由用户决定：是否接受 Workers Paid 的原生 SMTP，以及 SMTP 由 Cloudflare 直接管理凭证/撤销/额度这一边界。用户目前只确认“不加服务、两种都要”，不代表已接受付费或放弃统一管控。

HTTP 可作为独立子阶段先实施；SMTP 产品承诺保持“待决策”，不显示已可用。

**验收：** 确认目标库迁移基线；现有改动已记录；SMTP 决策结果写回本节。整体方案需 R1/R2 解除后才能标记全量可实施。

#### S1：定义地址与接入能力契约

新增仅管理员读取的 `GET /api/integration-capabilities`，返回当前 domain、地址/Key 上限及余量、SMTP 模式状态与可公开的配置状态，不返回任何 Secret。默认上限保留 5/20；UI 从服务端读取，不再宣称是平台硬限制。不本期自动放大上限；未来可配置上限可单列增量。

对新引导使用 local-part 输入，旁边显示固定 `@EMAIL_DOMAIN` 和最终地址；错误域名/完整邮箱输入要求更正，避免静默改成不同地址。确定新增 `POST /api/aliases` 请求形式 `{localPart: string}`，与旧 `{address: string}` 互斥；同时提供或同时缺少两字段返回 400。新分支在服务端拒绝含 `@` 的输入并按明确的 local-part 子集校验，再调用创建逻辑，不能只靠前端；原 normalizeAddress 的既有默认契约保持。

扩展 `POST /api/aliases` 的成功响应，在保留 address 的前提下增加 id、enabled、isDefault、createdAt；两种请求都返回此兼容实体。固定契约测试，不能让客户端通过未约定顺序猜 aliasId；新引导使用 `{localPart}`，保留旧 `{address}` 请求形状和原默认规范化行为。

**验收：** 旧 `{address}` 客户端仍能读取；新调用直接拿到 id；无域名、重复、非法 local-part、数量超限均有确定错误；新增地址不意外切换已有默认身份。

#### S2：处理创建与状态一致性

用现有 aliases/API Key 路由逐步编排，无需为引导新建 projects 表。顺序为创建/选择地址 → 创建 Key → 生成配置；先检查余量，实际创建时仍以后端为准。Key 服务应拒绝新建到已停用地址；现有历史 Key 的启停语义不变。

地址成功、Key 创建失败时，保留新地址和 aliasId 供重试，不自动删除地址；界面显示已完成哪一步。Key 成功但响应丢失时无法重新读取秘密，刷新列表后指引停用该 Key 并重新创建，不盲目连续重建。Key 数量达到上限时给出管理入口。

并发创建时使用数据库支持的条件写入/约束保证最后名额和默认地址不被竞争绕过；不是仅在前端禁用按钮。保留现有地址唯一性。创建成功更新 SettingsView 的 aliases，刷新 Key 可选地址及配额余量，原邮件设置入口同步可见。

**验收：** 模拟重复提交、地址成功后 Key 失败、最后一个名额并发、另一个标签页停用地址；恢复步骤不产生错误绑定、不删除既有邮件、不更改已有默认身份。

#### S3：完成“项目接入”引导与配置

在现有设置增加项目接入视图，兼容旧 `?tab=apikeys` 链接；地址视图保留直接创建入口，并可从地址行进入“用于项目发信”，自动选定该地址。

完成后显示项目名、发件地址、HTTPS Endpoint、Key 和 HTTP 示例。Key 仅本次响应在内存中显示，可复制；关闭后仅显示前缀与重新创建指引，不存 localStorage，不在 URL/日志中输出。后端/无服务端边界明确，纯静态网页不嵌入发信 Key。

生成 Node/fetch、curl、Python/PHP 的基础示例；具体框架示例随用户实际接入项目增加，不承诺安装 SDK 即可涵盖所有项目。示例的环境变量名可用 `MANKR_MAIL_API_URL`、`MANKR_MAIL_API_KEY`；发件地址由 Key 绑定，不能让调用方通过 body 任意改 From。

配置状态拆分：地址已创建；收信未验证/已测试；活动平台有凭证/域名未验证/发信测试完成。当前系统不能自动证明 DNS、平台身份就绪，未知状态不显示成功。catch-all 一次配置后，应用中的新地址可被处理；逐地址路由用户需要在 Cloudflare 增加对应路由，不自动提升 Token 权限来代管 DNS。

测试分两类：“本站代发测试”只说明配置链路可用；“真实项目接入成功”需要调用方用所生成 Key 完成一次请求，不能由管理端 Cookie 发信冒充。测试由用户显式触发，使用其指定收件人；测试也计入 Key 配额和平台用量。

**验收：** 无地址时可在同一流程创建并继续；旧地址可复用；手机上可完成操作；中英文、无平台配置、无路由、Key 已丢失和复制失败状态明确。真实项目发出后，本站日志能确认该 Key 的请求。

#### S4：发送记录、配额管理与生命周期

新增 Cookie-only 管理接口，例如 `GET /api/api-send-logs?apiKeyId=&status=&cursor=&limit=`，按 created_at/id 游标分页，最大页长固定；复用日志索引，不提供任意 SQL/无限导出。视图展示项目名/Key 前缀、发件地址、收件人、主题、时间、现有 sent/failed、errorCode 和 providerMessageId。`sent` 显示“平台已接受”，不能显示“已送达”；无正文保留，不为日志页保存验证码正文。

现有 401/400/429 在上游调用前返回，没有逐封 api_send_logs。不能假定失败日志包含全部拒绝；第一版说明此范围，调用方保留请求错误及关联标识。若要记录所有拒绝，需单独的有界诊断事件，不把未鉴权请求强行绑定到某个项目，不改变 getUsageByKey 的 failed 口径。

现有 PATCH 支持编辑名称与小时/每日额度，UI 补充编辑入口。明确额度按每把 Key 的成功请求数计算，多收件人调用消耗的平台额度另算；Key 配额是软限额，不是费用硬上限。显示活动平台的共享额度及数据新鲜度；不将多个 Key 的额度相加视为保证可用额度。

生命周期默认停用而不是删除，以便保留日志；删除仍明确提示级联清理，不在本期无提示改变旧接口。轮换通过新建 Key → 调用方切换验证 → 停用旧 Key，按 Key 显示日志，避免宣称轮换前后项目总配额连续。地址停用前提示受影响的全部 Key 和收信影响；明确阻止后续新鉴权请求，已在途请求不承诺撤回。

**验收：** 无 Cookie、仅项目 Bearer 均不能读管理日志；分页无重复/遗漏；编辑配额生效；旧聚合不变；停用 Key 不影响其他 Key；地址停用影响全部绑定 Key；删除提示与实际外键行为一致。

#### S5：HTTP 发信可靠性与错误契约

为新调用方支持可选 `Idempotency-Key`，旧客户端不带 Header 仍按旧请求/响应工作。不把支持幂等写成默认无限期 exactly-once 保证。

新增专用 `api_send_requests` 表（拟用下一可用 migration 编号，实施时检查是否已占用）：id、api_key_id、idempotency_key_hash、payload_hash、state、provider、provider_message_id（可空）、log_id（可空）、created_at/updated_at/expires_at；唯一 `(api_key_id,idempotency_key_hash)`。使用独立表，避免给旧日志追加无默认 NOT NULL 字段。应用幂等保证窗口定为首次请求起 24 小时；窗口外可能作为新请求处理，调用方不得用旧键重新提交不确定结果。明确在服务端比较 expires_at，不能用清理任务是否准点执行决定有效期；过期记录保留至 48 小时后有界清理，重用过期键时仍需原子认领。日志正文不因 payload_hash 而被存储。

原子认领请求后才调用上游；并发同键只允许一次调用；同键不同正文返回冲突，不复用错误邮件。已接受请求返回同一次原日志 id；处理中返回明确的处理中响应和 Retry-After；上游接受与否无法确定时保留 unknown，不自动重发或切换平台。状态/响应码必须列入接口文档：建议仅带新 Header 的请求使用 `409 request_in_progress/idempotency_conflict`；未知结果沿用 `502` 并增加可选 `requestId`、`retryable:false`、`state:unknown`，不破坏旧字段。最终响应字段需由契约测试固定。

已有适配器将 fetch/响应解析异常折叠为 provider_error；要区分 unknown，须在适配器增加向后兼容的可选失败元数据或以新增方法暴露，旧 error 字段和 Web 分支仍可处理；三个适配器与缺配置适配器都要覆盖。上游支持幂等时按官方能力透传，缺失时不能把本地认领误当成跨网络崩溃的完全去重。对上游超时、D1 写入失败采取保守未知结果，明确人工核查与重新提交条件。

确认接受后，日志、Key 使用量、平台用量和请求状态需要在可行范围内同批持久化，避免重复记账。配额仍维持原先的 Key 成功请求软限制，若要变为硬限额，需另设计预留/释放，不在这一步悄悄改变语义。

**验收：** 两个并发相同幂等键只调用一次适配器；同键不同 payload 拒绝；上游接受后数据库失败/响应丢失不盲目重发；用量不重复；旧不带 Header 的客户端及 Web 草稿发送回归通过。

#### S6：仅在 R1/R2 决策后推进 SMTP 分支

若用户接受“原生托管 SMTP、付费条件与独立控制边界”，使用 Cloudflare 提供的真实 465/TLS 端点。本站提供配置模板：`MAIL_HOST=smtp.mx.cloudflare.net`、`MAIL_PORT=465`、隐式 TLS、用户名 `api_token`、密码为用户为该项目单独创建的 Cloudflare 发信 Token、From 为接入域名下新地址。模板必须区分框架的 `secure`/`encryption` 字段语义，不能把隐式 TLS 配成 STARTTLS。

本期不自动创建 Cloudflare Token，不引入能管理 Token 的高权限主凭证；只引导用户在 Cloudflare 完成 Token 创建/撤销，再填入目标项目。本站不回显或复制现有平台主密钥，不保存可恢复的 SMTP 密码。不同项目分别配置 Token，并诚实显示其账号/域名权限范围。

直连 SMTP 的状态先显示“由 Cloudflare 管理”，提供正确管理入口；未获得相应事件/查询能力前，不在 api_send_logs 或按 Key 统计中伪造记录。SMTP 测试须由真实 SMTP-only 项目完成。站内 HTTP Key 停用与 SMTP Token 撤销分别操作并分别验证；停止某别名的站内接收不表示原生 SMTP 发件权限已被取消。

若需要将外部 SMTP 日志同步到本站，须另开设计验证官方事件、必要权限、关联信息和不重复计数方式；不能把现有 provider_usage 或平台“总发送量”伪装成项目级记录。当前三渠道活动配置保持不变；是否加 Cloudflare HTTP 适配器不是使用原生 SMTP 的前置条件，暂不联动扩充枚举/密钥 CHECK 约束。

若用户要求 SMTP 与 HTTP 同等的本站统一凭证、硬隔离和一键停用，则 S6 不可执行，回到 R1/R2 重新规划；不以“原生 SMTP 能连接”视为满足该要求。

**验收：** 真实 SMTP 项目能以新地址发送；TLS 和客户端参数正确；外部 Token 撤销后不能新发；站内显示真实控制边界；免费/未开通账号不显示可用；没有向调用方分发主密钥。付费与权限配置不在本次评审执行。

#### S7：联调、同步文档与分段发布

顺序调整理由：先确认 S0，再交付向后兼容的 S1/S2 后端，再接 S3 UI；S4 日志可独立交付；S5 必须先迁移再启用新 Header 行为；SMTP 必须先决策后发布。每一段旧 HTTP 客户端、旧设置入口和 Web 写信都可继续使用。新增字段/表先保留，回退前端或特性开关即可停用新流程，不通过删除新表来进行紧急回滚。

同步 `docs/API.md`、`docs/DEPLOY.md`、README 与中英文文案，明确：地址与用户区别、catch-all 前提、平台域名验证、API/SMTP 两套凭证、Key 软配额单位、平台共享额度、日志保留、未知结果和 SMTP 成本。旧 API 地址/状态形状保持兼容；项目凭证不获得管理员权限。

验收矩阵至少覆盖：

| 场景 | 通过条件 |
| --- | --- |
| 无地址创建 → HTTP 项目 | 同一引导创建地址、Key，真实服务端请求成功，日志可查 |
| 已有地址 → 第二 HTTP 项目 | 独立 Key；请求 From 不可越权；停用一个不影响另一个 |
| 新地址接收回复 | 路由完成后外部回信进入原收件箱；路由未配置显示未验证 |
| 数量/并发/重复 | 5 地址与 20 Key 边界、并发最后名额、重复名称/地址、跨步失败可恢复 |
| 密钥丢失和轮换 | 无恢复明文后门；新 Key 验证后停用旧 Key，日志保留范围正确 |
| 错误与配额 | 401/400/429/502、缺平台配置、平台拒绝与未知结果可区分；配额和平台用量口径一致 |
| HTTP 重试 | 并发、超时、接受后写库失败、丢失响应，旧客户端与新 Header 分别验证 |
| SMTP-only 项目 | 仅 R1/R2 解除后验收；正确使用原生端点/Token/TLS，撤销在 Cloudflare 生效 |
| 两种协议边界 | 无本站 API Key 可登录原生 SMTP 的误导；无 SMTP 日志已纳入本站总额的误报 |
| 回归 | Web 写信/草稿/默认别名、入站过滤、用量页、旧设置链接不受损 |

测试对应：aliases、api-keys、public-send、inbound、send-adapter、send-providers、usage；新建日志权限、幂等与创建竞争的针对性测试。涉及数据库并发/唯一性和迁移的验收须使用本地 D1/兼容真实约束环境，不能只依赖 prepare mock。实施后运行 `pnpm test`、前端构建及与实际修改相关的检查；真实投递需用户指定测试环境与收件人，不能用 mock 通过代替。

### 7. 最终影响面（对初始变更集的增补/收缩）

- 管理 UI：既有 aliases/api-keys/settings，新增项目引导、日志列表；types/i18n；保留已有样式改动和旧链接。
- 地址管理：aliases/routes/service，新增严格输入模式、兼容响应、并发创建保证；不改入站匹配与旧默认地址契约。
- 项目发信：public-routes、api-keys/routes/service/quota、middleware/app；新增只读能力与日志管理接口。Bearer 凭证仅能发信，管理接口仍须 Cookie。
- 可靠性：新增 HTTP 专用 requests 表、service 与迁移；适配器只新增兼容失败/幂等能力；Web 调用保持旧契约。明确 SendInput/SendResult 和三个适配器需要一同审视，不能只改 Resend。
- SMTP：当前没有可直接修改的 SMTP 模块；网关已排除。候选只涉及配置引导与外部原生服务能力，实际 UI/配置元数据需 R1/R2 解除后确定。**暂不**增加 `cloudflare` SendProviderId 或修改 `send_provider_secrets` 的 CHECK 枚举。
- 配置：第一期复用现有域名与平台密钥，不增加必填 Secret；原生 SMTP 候选涉及 Cloudflare 账号套餐和项目独立 Token，不能用原 CLOUDFLARE_API_TOKEN（分析读取用途）替代。
- 文档与测试：见 S7；不实施联系人、会话串联、附件、多域名、多用户和营销群发。

### 8. 核对方式、证据范围与尚未核对

- CodeGraph CLI status 发现索引滞后，已 sync 27 个变更文件；本会话无 CodeGraph MCP，使用同等 CLI context/explore/callers/impact。
- context/explore：registerPublicSendRoutes、registerApiKeyRoutes、createApiKey、registerAliasRoutes、AliasesSettings、ApiKeysSettings；追踪 Key 创建、地址创建、发信、聚合与 UI。
- context/callers/impact：getSendAdapter、resolveSendConfig、registerSendRoutes、recordSendStatements、createAlias、normalizeAddress、SendInput；并读取共享适配器和 Web 发送入口判断链外契约。
- 已读取管理路由/服务、配额、中间件、三个适配器、平台配置、迁移与公开发信测试；核对现有前端 Key/地址表单、SettingsView 状态、API/部署文档。
- 本地 SQLite 仅只读查询表结构与迁移名，不读取邮件/凭证内容；看到根目录本地库存在版本差异，不能据此推断线上或当前服务实际库状态。
- 官方文档核对公网 TCP 与原生 SMTP、Token 和费用前提；尚未实际开通、付费、创建 Token、发信、做 SMTP 兼容性或账号权限实测。投递事件关联与按项目查询能力未核对，未列为已可实现。
- 评审仅修改本计划并刷新本地索引；没有修改实现、执行迁移、部署或外发测试邮件。

### 9. 暂不处理

客户端归档/联系人/会话等通用功能；多域名/多用户；附件/营销模板；SMTP 网关；自动管理 Cloudflare 高权限 Token；全站硬配额重构；SMTP 事件自动同步和统一项目账本。若新增这些需求，单独评审，不能静默混入本专项。

### 10. 下一步

先决定 R1/R2：是否接受 Cloudflare 原生 SMTP 的付费前提与独立控制边界。随后按 S0–S5/S7 实施站内创建地址及 HTTP 接入；SMTP 必须按 S6 单独验收，不能省略。此次技能是计划评审，实施需用户后续明确发起。
