# 项目接入实施与验收记录

实施范围依据 [专项计划](./superpowers/plans/2026-11-04-project-mail-integration.md)。用户确认仅部署在 Cloudflare，不新增服务；暂不接受付费原生 SMTP 及独立管理边界，SMTP 本期保持待配置。

## 已实现

- 设置页“项目接入”兼容旧 `?tab=apikeys` 链接，支持选用地址，或在同一流程创建新地址、绑定密钥、复制配置。地址行可直接进入该流程。
- 新地址输入为前缀与固定域名后缀，后台严格校验；旧 `address` 请求及归一化行为保留，成功响应扩展为完整实体。
- 地址与密钥上限仍为 5/20，前端从管理员能力接口读取；条件写入守住并发的最后名额，不意外替换已有默认地址；拒绝新密钥绑定停用地址。
- 地址成功但密钥失败时保留地址；地址响应丢失可重新读取实体；密钥响应未知时阻止重复提交，提示核对、停用后重建。密钥仅在内存展示一次，不写 URL、本地存储或日志。
- 提供 `.env`、curl、Node.js、Python、PHP 示例，明确密钥属于调用方服务端。提供显式触发的 Bearer 测试，不以管理员 Cookie 发送冒充项目调用。
- 密钥名称与额度编辑、启停、删除确认；地址停用前展示全部绑定密钥和收信影响。删除级联清理及轮换顺序均有提示。
- 管理员发送日志按项目密钥/状态筛选，按时间和 ID 游标分页；最多 100 条一页，保留最近 30 天元数据。“平台已接受”和“已送达”分开，未知结果单列说明。
- HTTP 可选幂等头：24 小时窗口、原子认领、相同内容重放、不同内容冲突、处理中反馈、结果未知禁止自动重发。Resend 透传派生的上游幂等键。平台接受后的日志、Key 计数、平台用量、请求状态在同一 D1 批次提交。
- 三个平台的兼容失败元数据区分明确拒绝与网络/5xx 未知结果；Web 原发信契约和草稿路径保留。
- 地址创建、收信路由、平台凭证、域名验证与 SMTP 状态分别展示，未知状态不显示已就绪。中英文文案与 API/部署文档已同步。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| 现有测试基线 | 186 项通过 |
| 最终完整后端测试 | 18 个文件、219 项通过，新增 33 项 |
| 数据库约束 | 真实 SQLite 执行生产迁移与 SQL，覆盖地址/Key 最后名额竞争、默认身份、幂等竞争、分页、停用与删除级联 |
| Cloudflare 本地运行时 | 隔离的本地 D1 成功执行 0001–0009（包含两个不同的 0005 文件），实际 Worker 可创建地址与密钥 |
| 前端 | 生产构建和相关 ESLint 通过；桌面和 390×844 手机布局实际检查，无页面横向溢出；中英文均验证 |
| 浏览器交互 | 无地址创建、非法输入纠正、地址创建后 Key 失败恢复、一次性秘密、额度编辑、深链接选址、停用影响提示、未配置平台错误记录、状态筛选均验证 |
| 真实 HTTP 外发 | 独立 Python 调用方使用项目 Bearer 密钥，通过本地 Cloudflare Worker 与已有发信平台发送一封邮件，返回 201，用户确认已收到 |
| 真实幂等重放 | 同键重试返回相同日志 ID 与 `Idempotent-Replayed: true`，日志仅一条；验收密钥随后停用 |
| 兼容 | 原 186 项用例保持通过；Web 发信、草稿、入站过滤和用量回归包含在内 |

实际投递使用隔离 D1，复用本地已有平台配置；没有向其他业务站点分发主密钥。真实 HTTP 调用不代表已经替用户修改某个外部业务项目；目标项目按页面示例接入即可。

执行的主要检查：

```bash
pnpm test
pnpm --filter @mankr/web build
pnpm --filter @mankr/web exec eslint src/features/settings/api-keys-settings.tsx src/features/settings/aliases-settings.tsx src/features/settings/integration-examples.tsx src/features/settings/integration-logs.tsx src/features/settings/integration-test.tsx src/features/settings/settings-view.tsx
pnpm exec tsc -p apps/worker/tsconfig.json --noEmit --typeRoots apps/web/node_modules/@types,apps/worker/node_modules --types @cloudflare/workers-types,node
git diff --check
```

Worker 类型检查显式复用工作区现有 Node 类型，因为既有 messages/service.ts 使用 Buffer，而 Worker tsconfig 默认只声明 Cloudflare 类型；未为此改动无关业务代码。前端仍有现有的大包体提示，构建成功；不是本专项扩展范围。

## 本地数据库与预览

现有开发库原先只执行到 0007，已先通过 SQLite backup API 做一致性备份，再应用 0008/0009。本地备份位于 `/tmp/flarepost-pre-integration-d1/`，不会替代生产备份。旧的另一份 0001/0002 本地库没有升级。

当前 `5193` 是已有的隔离演示预览（`/tmp/flarepost-preview.mts`），其 mock 未包含新管理接口，会显示能力读取失败；不能用它判断实际 Worker 的能力。正常开发使用仓库的 `pnpm dev`（现有 Vite 为 localhost:5174，代理 8787），或部署后的正式站点。没有把演示预览的假数据混接到实际管理员接口。

现有未提交的视觉与布局改动已保留，没有提交、回退或覆盖这些工作。本次没有部署远端 Worker 或迁移远端 D1。

## 保留的验收边界

- SMTP 根据用户选择延期，界面保持待配置，不启用付费能力或新增网关。
- 已确认外发邮件实际收到；Cloudflare 生产入站路由和从外部邮箱回复到新地址尚未实测。需要已部署站点及正确 catch-all/逐地址规则，不能用隔离本地地址或单元测试冒充入站验收。
- 站内状态不会因一次测试自动宣称整个域名或所有地址已验证；平台接受也不保证后续每次送达。
- 项目 Key 是软额度，SMTP 独立托管和费用硬上限均未实现；不把平台共享用量伪装成项目硬额度。

上线时先执行迁移再发布代码，并按 [部署指南](./DEPLOY.md) 完成目标站点的路由与回复验收。
