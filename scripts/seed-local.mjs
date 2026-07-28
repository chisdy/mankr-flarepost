#!/usr/bin/env node
/**
 * Fills the local D1 database with a dataset big and varied enough to review the
 * UI against: 4 aliases, 6 tags, 4 filter rules, ~110 messages spread over every
 * folder (inbox longer than one page so "load more" appears), HTML and
 * plain-text bodies, CJK/RTL/emoji subjects, XSS probes for the sanitizer,
 * API keys with known plaintext secrets, and 30 days of send logs.
 *
 * Addresses are built from EMAIL_DOMAIN in .dev.vars, so aliases match the
 * domain the dev server actually runs with. Re-running replaces all mail data;
 * the users table is left alone unless --admin is passed.
 *
 * Usage:
 *   pnpm db:seed:local
 *   pnpm db:seed:local --admin              # also create admin / admin12345
 *   pnpm db:seed:local --domain=foo.dev
 *   pnpm db:seed:local --print              # only write the SQL, do not apply
 */
import { execFileSync } from 'node:child_process'
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const OUT_PATH = '.wrangler/tmp/seed-local.generated.sql'
const PBKDF2_ITERATIONS = 100_000

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}

function readDevVar(key) {
  try {
    const match = readFileSync('.dev.vars', 'utf8').match(
      new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm'),
    )
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined
  } catch {
    return undefined
  }
}

const DOMAIN = option('domain', process.env.EMAIL_DOMAIN || readDevVar('EMAIL_DOMAIN') || 'example.com')
  .trim()
  .toLowerCase()
const ADMIN_USERNAME = option('admin-user', 'admin')
const ADMIN_PASSWORD = option('admin-password', 'admin12345')

// ---------------------------------------------------------------- primitives

const NOW = Date.now()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Fixed seed: two runs produce byte-identical data, so diffs stay meaningful. */
function rngFrom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = rngFrom(20260727)
const pick = (list) => list[Math.floor(rnd() * list.length)]
const chance = (p) => rnd() < p
const between = (min, max) => min + rnd() * (max - min)

function sql(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(Math.round(value))
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Chunked multi-row INSERTs: one statement per ~40 rows keeps the file small. */
function insertMany(table, columns, rows, chunkSize = 40) {
  if (rows.length === 0) return ''
  const out = []
  for (let i = 0; i < rows.length; i += chunkSize) {
    const values = rows
      .slice(i, i + chunkSize)
      .map((row) => `  (${columns.map((col) => sql(row[col])).join(', ')})`)
      .join(',\n')
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`)
  }
  return `${out.join('\n\n')}\n`
}

// -------------------------------------------------------------------- aliases

const ALIASES = [
  { id: 'alias-hello', local: 'hello', enabled: 1, isDefault: 1, ageDays: 40 },
  { id: 'alias-work', local: 'work', enabled: 1, isDefault: 0, ageDays: 32 },
  { id: 'alias-blog', local: 'blog', enabled: 1, isDefault: 0, ageDays: 18 },
  { id: 'alias-old', local: 'old', enabled: 0, isDefault: 0, ageDays: 9 },
]

const addressOf = (aliasId) => `${ALIASES.find((a) => a.id === aliasId).local}@${DOMAIN}`

// ----------------------------------------------------------------------- tags

const TAGS = [
  { id: 'tag-important', name: '重要', color: '#ef4444' },
  { id: 'tag-work', name: '工作', color: '#3b82f6' },
  { id: 'tag-newsletter', name: '订阅', color: '#a855f7' },
  { id: 'tag-receipt', name: '账单', color: '#22c55e' },
  { id: 'tag-todo', name: '待办', color: '#f59e0b' },
  { id: 'tag-personal', name: 'Personal', color: null },
]

// -------------------------------------------------------------------- filters

const FILTERS = [
  {
    id: 'filter-newsletter',
    name: '订阅邮件自动打标签',
    enabled: 1,
    priority: 10,
    match_mode: 'or',
    conditions: [
      { type: 'from_contains', value: 'newsletter@' },
      { type: 'subject_contains', value: '周报' },
    ],
    actions: { addTagIds: ['tag-newsletter'] },
  },
  {
    id: 'filter-work-star',
    name: '工作别名收信加星',
    enabled: 1,
    priority: 20,
    match_mode: 'and',
    conditions: [{ type: 'to_alias_id', value: 'alias-work' }],
    actions: { addTagIds: ['tag-work'], setStarred: true },
  },
  {
    id: 'filter-spam',
    name: '可疑来信直接进垃圾邮件',
    enabled: 1,
    priority: 5,
    match_mode: 'or',
    conditions: [
      { type: 'from_contains', value: 'noise.biz' },
      { type: 'subject_contains', value: '中奖' },
    ],
    actions: { moveToSpam: true },
  },
  {
    id: 'filter-legacy',
    name: '旧集成（已停用，用于测试开关）',
    enabled: 0,
    priority: 30,
    match_mode: 'and',
    conditions: [{ type: 'body_contains', value: 'legacy-integration' }],
    actions: { addTagIds: ['tag-todo'] },
  },
]

// ------------------------------------------------------------------- messages

const messages = []
const messageTags = []

function addMessage(msg) {
  const { tagIds = [], ...row } = msg
  messages.push({
    html_body: null,
    is_read: 1,
    is_starred: 0,
    provider_message_id: null,
    has_unsupported_attachments: 0,
    last_error_code: null,
    deleted_at: null,
    ...row,
    to_addrs: JSON.stringify(row.to_addrs),
  })
  for (const tagId of tagIds) {
    messageTags.push({ message_id: row.id, tag_id: tagId })
  }
}

const LONG_PARAGRAPH =
  '这一段用来测试长正文的滚动与换行表现。混排 English words、数字 1234567890 和标点，' +
  '看看行高、字距和 pre-wrap 是否正常。'

const XSS_HTML =
  '<p>安全检查：下面这些应当被清理掉。</p>' +
  "<script>alert('xss')</script>" +
  '<img src="x" onerror="alert(1)">' +
  "<a href=\"javascript:alert('xss')\">恶意链接</a>" +
  '<p onclick="alert(1)">带内联事件的段落</p>' +
  '<iframe src="https://example.com"></iframe>' +
  '<style>body{display:none}</style>' +
  '<p>保留部分：<strong>加粗</strong>、<em>斜体</em>、' +
  '<a href="https://example.com">正常链接</a>、<code>inline code</code>。</p>'

/** Hand-written edge cases, newest first so they sit at the top of the inbox. */
const SPECIAL_INBOX = [
  {
    id: 'msg-special-html',
    alias_id: 'alias-hello',
    from_addr: 'newsletter@devtools.weekly',
    subject: 'DevTools 周报 #142：Workers 新特性、D1 迁移的三个坑，以及免费额度实测',
    text_body: '本期看点：Workers 新特性、D1 迁移的三个坑、免费额度实测。在浏览器中查看：https://example.com/issues/142',
    html_body:
      '<h2 style="margin:0 0 12px">DevTools 周报 #142</h2>' +
      '<p>本期看点：</p>' +
      '<ul><li>Workers 的 <code>compatibility_date</code> 行为变更</li>' +
      '<li>D1 迁移里最容易踩的三个坑</li>' +
      '<li>免费额度下的邮件方案实测对比</li></ul>' +
      '<blockquote><p>“先让它跑起来，再让它跑得快。”</p></blockquote>' +
      '<p><a href="https://example.com/issues/142">在浏览器中查看</a> · ' +
      '<a href="https://example.com/unsubscribe">取消订阅</a></p>',
    is_read: 0,
    created_at: NOW - 22 * MINUTE,
    tagIds: ['tag-newsletter'],
  },
  {
    id: 'msg-special-plain',
    alias_id: 'alias-hello',
    from_addr: 'alice@friend.dev',
    subject: '周末爬山？',
    text_body:
      '嗨！\n\n周六天气不错，去香山走一圈吗？大概上午九点出发。\n\n顺便问下，你上次说的那个咖啡店叫什么名字来着。\n\n— Alice',
    is_read: 0,
    created_at: NOW - 55 * MINUTE,
    tagIds: ['tag-personal'],
  },
  {
    id: 'msg-special-work-star',
    alias_id: 'alias-work',
    from_addr: 'pm@startup.io',
    subject: 'Q3 路线图初稿，请在周三前反馈',
    text_body: '路线图初稿已经更新，重点是第 3 节的排期。请在周三前给出反馈。',
    html_body:
      '<p>Hi,</p><p>路线图初稿已更新，重点看 <strong>第 3 节</strong> 的排期：</p>' +
      '<ol><li>别名管理收尾</li><li>写信 / 富文本编辑器</li><li>部署文档与一键部署</li></ol>' +
      '<p>请在周三前反馈。<br>— PM</p>',
    is_read: 0,
    is_starred: 1,
    created_at: NOW - 2 * HOUR,
    tagIds: ['tag-work', 'tag-important'],
  },
  {
    id: 'msg-special-attachment',
    alias_id: 'alias-blog',
    from_addr: 'photos@camera.club',
    subject: '周末拍的照片（带附件，应显示不支持附件的提示）',
    text_body: '照片在附件里。当前版本不保存附件，所以这封应该出现「附件不受支持」的提示条。',
    html_body: '<p>照片在附件里。</p><p><em>当前版本不保存附件，应显示提示条。</em></p>',
    has_unsupported_attachments: 1,
    created_at: NOW - 5 * HOUR,
  },
  {
    id: 'msg-special-xss',
    alias_id: 'alias-hello',
    from_addr: 'security-probe@example.org',
    subject: 'XSS 净化检查（脚本、内联事件、javascript: 链接）',
    text_body: '这封信的 HTML 里塞了 script / onerror / javascript: 链接，用来验证前端净化逻辑。',
    html_body: XSS_HTML,
    is_read: 0,
    created_at: NOW - 8 * HOUR,
    tagIds: ['tag-todo'],
  },
  {
    id: 'msg-special-receipt',
    alias_id: 'alias-work',
    from_addr: 'billing@cloudvendor.com',
    subject: '2026 年 7 月账单已生成',
    text_body: '本月账单合计 $5.00，付款方式 VISA **** 4242。',
    html_body:
      '<p>您好，这是本月账单。</p>' +
      '<table border="1" cellpadding="6" cellspacing="0">' +
      '<thead><tr><th>项目</th><th>用量</th><th>金额</th></tr></thead>' +
      '<tbody><tr><td>Workers Paid</td><td>1</td><td>$5.00</td></tr>' +
      '<tr><td>D1 存储</td><td>2 GB</td><td>$0.00</td></tr>' +
      '<tr><td>Email Routing</td><td>1.2 万封</td><td>$0.00</td></tr></tbody>' +
      '<tfoot><tr><td colspan="2">合计</td><td>$5.00</td></tr></tfoot></table>' +
      '<p style="color:#6b7280;font-size:12px">付款方式：VISA **** 4242</p>',
    created_at: NOW - 14 * HOUR,
    tagIds: ['tag-receipt', 'tag-important'],
  },
  {
    id: 'msg-special-no-subject',
    alias_id: 'alias-hello',
    from_addr: 'anonymous@nowhere.test',
    subject: '',
    text_body: '这封信没有主题，列表和详情页都应该回退到「无主题」文案。',
    is_read: 0,
    created_at: NOW - 20 * HOUR,
  },
  {
    id: 'msg-special-long',
    alias_id: 'alias-hello',
    from_addr: 'docs@longform.example',
    subject: '超长正文：用来测试详情页滚动与阅读体验',
    text_body: Array.from({ length: 24 }, (_, i) => `第 ${i + 1} 段。${LONG_PARAGRAPH}`).join('\n\n'),
    created_at: NOW - 26 * HOUR,
  },
  {
    id: 'msg-special-overflow',
    alias_id: 'alias-hello',
    from_addr: 'a-very-long-sender-address-for-truncation-check@extremely-long-subdomain.example.com',
    subject:
      '超长不换行内容测试 https://example.com/a/very/long/url/that/should/not/break/the/layout?token=abcdefghijklmnopqrstuvwxyz0123456789 结束',
    text_body:
      '下面是一个超长 URL，用来验证不会把布局撑破：\nhttps://example.com/a/very/long/url/that/should/not/break/the/layout?token=abcdefghijklmnopqrstuvwxyz0123456789',
    created_at: NOW - 30 * HOUR,
  },
  {
    id: 'msg-special-i18n',
    alias_id: 'alias-blog',
    from_addr: 'i18n@polyglot.example',
    subject: '多语言与 emoji 🎉 日本語 العربية Ελληνικά',
    text_body:
      'こんにちは、これは日本語の本文です。\nمرحبا، هذا نص عربي من اليمين إلى اليسار.\nΓειά σου Κόσμε.\n表情：🎉🚀✅🧪',
    created_at: NOW - 2 * DAY - 3 * HOUR,
    tagIds: ['tag-personal'],
  },
  {
    id: 'msg-special-many-recipients',
    alias_id: 'alias-work',
    from_addr: 'allhands@bigcorp.example',
    subject: '全员通知：下周三系统维护',
    text_body: '下周三 22:00 - 24:00 系统维护，期间服务不可用。',
    to_addrs: [
      addressOf('alias-work'),
      'team-a@bigcorp.example',
      'team-b@bigcorp.example',
      'team-c@bigcorp.example',
      'ops@bigcorp.example',
    ],
    created_at: NOW - 3 * DAY,
    tagIds: ['tag-work'],
  },
  {
    id: 'msg-special-thread',
    alias_id: 'alias-hello',
    from_addr: 'zhangwei@partner.cn',
    subject: 'Re: Re: 合作方案第三版',
    text_body:
      '好的，按你说的改。\n\n> 2026-07-20 你写道：\n> 方案第 3 节的报价还需要再核对一遍。\n>\n>> 2026-07-18 张伟写道：\n>> 附件是第二版，重点在第 3 节。\n>>\n>>> 最早的那一版就先作废了。',
    created_at: NOW - 4 * DAY - 6 * HOUR,
  },
]

/** Bulk inbound generators, cycled to fill the rest of the inbox. */
const INBOX_KINDS = [
  (n) => ({
    alias_id: 'alias-hello',
    from_addr: 'newsletter@frontend.digest',
    subject: `前端周报 #${120 + n}`,
    text_body: `本期收录 ${5 + (n % 7)} 篇文章，主题围绕构建工具与浏览器新特性。`,
    html_body: `<p>本期收录 <strong>${5 + (n % 7)}</strong> 篇文章。</p><ul><li>构建工具对比</li><li>浏览器新特性</li><li>读者问答</li></ul><p><a href="https://example.com/digest/${120 + n}">阅读全文</a></p>`,
    tagIds: ['tag-newsletter'],
  }),
  (n) => ({
    alias_id: 'alias-work',
    from_addr: 'notifications@github.com',
    subject: `[mankr/flarepost] PR #${300 + n} 已合并`,
    text_body: `Pull request #${300 + n} 已被合并到 main 分支。\n\n查看：https://github.com/example/repo/pull/${300 + n}`,
    tagIds: ['tag-work'],
  }),
  (n) => ({
    alias_id: 'alias-work',
    from_addr: 'lisi@colleague.example',
    subject: `关于第 ${n % 12 + 1} 期迭代的几个问题`,
    text_body: `有几个点想确认下：\n\n1. 这期的验收标准以哪份文档为准\n2. 上线时间是否还是周四\n3. 灰度比例先按 10% 吗\n\n谢谢`,
    tagIds: chance(0.4) ? ['tag-work', 'tag-todo'] : ['tag-work'],
  }),
  (n) => ({
    alias_id: 'alias-hello',
    from_addr: 'billing@saasvendor.example',
    subject: `发票 INV-2026-${String(1000 + n).slice(-4)} 已开具`,
    text_body: `发票金额 $${(9 + (n % 40)).toFixed(2)}，可在控制台下载 PDF。`,
    html_body: `<p>发票金额 <strong>$${(9 + (n % 40)).toFixed(2)}</strong>。</p><p><a href="https://example.com/invoices/${1000 + n}">下载 PDF</a></p>`,
    tagIds: ['tag-receipt'],
  }),
  (n) => ({
    alias_id: 'alias-blog',
    from_addr: `reader${n}@readers.example`,
    subject: `读者留言：关于那篇 Cloudflare Workers 的文章`,
    text_body: `文章写得很清楚，不过有个地方我没看明白：第 ${2 + (n % 5)} 节里提到的绑定是怎么配置的？`,
  }),
  (n) => ({
    alias_id: 'alias-hello',
    from_addr: 'hr@recruiting.example',
    subject: `${['前端', '全栈', '后端'][n % 3]}岗位机会（远程）`,
    text_body: '看到你的项目，想聊聊一个远程岗位。方便的话回一封信约个时间。',
  }),
  (n) => ({
    alias_id: 'alias-hello',
    from_addr: 'promo@shopping.example',
    subject: `限时优惠：全站 ${5 + (n % 5)} 折`,
    text_body: '优惠仅剩 48 小时。（这封信用来测试搜索和批量已读。）',
    html_body: `<p style="color:#b91c1c;font-weight:700">限时优惠</p><p>全站 ${5 + (n % 5)} 折，仅剩 48 小时。</p>`,
  }),
  (n) => ({
    alias_id: 'alias-work',
    from_addr: 'support@cloudvendor.com',
    subject: `工单 #${7000 + n} 已回复`,
    text_body: `我们已回复你的工单。\n\n结论：这是配置问题，把 legacy-integration 的开关关掉即可。`,
  }),
  (n) => ({
    alias_id: 'alias-hello',
    from_addr: 'bob@example.org',
    subject: `下周喝咖啡？（第 ${n} 次约）`,
    text_body: '周四下午有空吗？老地方。',
    tagIds: ['tag-personal'],
  }),
]

const BULK_INBOX_COUNT = 62

for (const special of SPECIAL_INBOX) {
  addMessage({
    folder: 'inbox',
    direction: 'inbound',
    to_addrs: [addressOf(special.alias_id)],
    ...special,
  })
}

let cursor = NOW - 5 * DAY
for (let i = 0; i < BULK_INBOX_COUNT; i++) {
  cursor -= between(40 * MINUTE, 13 * HOUR)
  const kind = INBOX_KINDS[i % INBOX_KINDS.length](i + 1)
  const ageDays = (NOW - cursor) / DAY
  addMessage({
    id: `msg-inbox-${String(i + 1).padStart(3, '0')}`,
    folder: 'inbox',
    direction: 'inbound',
    to_addrs: [addressOf(kind.alias_id)],
    is_read: ageDays < 1.5 ? (chance(0.4) ? 1 : 0) : chance(0.85) ? 1 : 0,
    is_starred: chance(0.12) ? 1 : 0,
    has_unsupported_attachments: chance(0.14) ? 1 : 0,
    created_at: cursor,
    ...kind,
  })
}

const SENT_KINDS = [
  (n) => ({
    alias_id: 'alias-hello',
    to_addrs: ['bob@example.org'],
    subject: `Re: 下周喝咖啡？（第 ${n} 次约）`,
    text_body: '周四下午可以，四点老地方见。',
  }),
  (n) => ({
    alias_id: 'alias-work',
    to_addrs: ['client@acme.example', 'cc@acme.example'],
    subject: `方案第 ${n} 版说明`,
    text_body: '按上次会议的意见改了报价和排期，重点在第 3 节。',
    html_body: '<p>按上次会议的意见改了报价和排期，重点在 <strong>第 3 节</strong>。</p><ul><li>报价下调 8%</li><li>排期后移一周</li></ul>',
  }),
  (n) => ({
    alias_id: 'alias-blog',
    to_addrs: ['editor@magazine.example'],
    subject: `投稿：Cloudflare 全免费邮箱实践（第 ${n} 稿）`,
    text_body: '按编辑意见补了部署章节，字数约 4200。',
  }),
  (n) => ({
    alias_id: 'alias-work',
    to_addrs: [`candidate${n}@applicants.example`],
    subject: '面试安排确认',
    text_body: '面试定在周三上午十点，线上进行，链接稍后发送。',
  }),
]

cursor = NOW - 3 * HOUR
for (let i = 0; i < 24; i++) {
  cursor -= between(4 * HOUR, 32 * HOUR)
  const kind = SENT_KINDS[i % SENT_KINDS.length](i + 1)
  const failed = i === 6
  addMessage({
    id: `msg-sent-${String(i + 1).padStart(3, '0')}`,
    folder: 'sent',
    direction: 'outbound',
    from_addr: addressOf(kind.alias_id),
    is_starred: chance(0.1) ? 1 : 0,
    provider_message_id: failed ? null : `re_seed_${1000 + i}`,
    last_error_code: failed ? 'provider_error' : null,
    created_at: cursor,
    ...kind,
  })
}

const DRAFTS = [
  {
    alias_id: 'alias-hello',
    to_addrs: ['friend@example.com'],
    subject: 'WIP：周末的安排',
    text_body: '还没写完，从草稿箱打开应该能继续编辑。',
    created_at: NOW - 12 * MINUTE,
  },
  {
    alias_id: 'alias-work',
    to_addrs: [],
    subject: '',
    text_body: '',
    created_at: NOW - 3 * HOUR,
  },
  {
    alias_id: 'alias-work',
    to_addrs: ['client@acme.example'],
    subject: '报价单（待确认金额后再发）',
    text_body: '金额待确认，先把结构写好。',
    html_body: '<p>金额待确认，先把结构写好。</p><ol><li>背景</li><li>范围</li><li>报价</li></ol>',
    created_at: NOW - 9 * HOUR,
  },
  {
    alias_id: 'alias-blog',
    to_addrs: ['editor@magazine.example', 'assistant@magazine.example'],
    subject: '下一篇选题：D1 迁移实战',
    text_body: Array.from({ length: 6 }, (_, i) => `要点 ${i + 1}。${LONG_PARAGRAPH}`).join('\n\n'),
    created_at: NOW - 2 * DAY,
  },
  {
    alias_id: 'alias-hello',
    to_addrs: ['zhangwei@partner.cn'],
    subject: 'Re: Re: 合作方案第三版',
    text_body: '收到，我周一回复详细意见。',
    created_at: NOW - 4 * DAY - 2 * HOUR,
  },
  {
    alias_id: 'alias-hello',
    to_addrs: ['nobody@example.com'],
    subject: '很久以前的草稿',
    text_body: '这封草稿用来验证排序：它应该排在草稿箱最后。',
    created_at: NOW - 21 * DAY,
  },
]

DRAFTS.forEach((draft, i) => {
  addMessage({
    id: `msg-draft-${String(i + 1).padStart(3, '0')}`,
    folder: 'draft',
    direction: 'outbound',
    from_addr: addressOf(draft.alias_id),
    ...draft,
  })
})

const TRASH_KINDS = [
  (n) => ({
    alias_id: 'alias-hello',
    direction: 'inbound',
    from_addr: 'spam@noise.biz',
    to_addrs: [addressOf('alias-hello')],
    subject: `恭喜您中奖了！！！（第 ${n} 封）`,
    text_body: '明显是垃圾邮件，用来测试还原与清空回收站。',
  }),
  (n) => ({
    alias_id: 'alias-blog',
    direction: 'outbound',
    from_addr: addressOf('alias-blog'),
    to_addrs: ['editor@magazine.example'],
    subject: `误删的投稿草稿 ${n}`,
    text_body: '还原后应该回到「已发送」，而不是收件箱。',
    provider_message_id: `re_seed_trash_${n}`,
  }),
  (n) => ({
    alias_id: 'alias-work',
    direction: 'inbound',
    from_addr: `no-reply-${n}@promotions.example`,
    to_addrs: [addressOf('alias-work')],
    subject: `已读并删除的推广 ${n}`,
    text_body: '这类信件用来填充回收站列表。',
    has_unsupported_attachments: n % 3 === 0 ? 1 : 0,
  }),
]

cursor = NOW - 6 * HOUR
for (let i = 0; i < 14; i++) {
  cursor -= between(6 * HOUR, 40 * HOUR)
  const kind = TRASH_KINDS[i % TRASH_KINDS.length](i + 1)
  addMessage({
    id: `msg-trash-${String(i + 1).padStart(3, '0')}`,
    folder: 'trash',
    created_at: cursor,
    deleted_at: cursor + between(1 * HOUR, 20 * HOUR),
    ...kind,
  })
}

// --------------------------------------------------------------------- spam

const SPAM_SUBJECTS = [
  '恭喜您中奖了，请立即领取',
  'Your account will be suspended — verify now',
  '限时优惠：0 元购',
  '【紧急】账单逾期通知',
  'Re: invoice attached',
  '低价代开发票',
]

cursor = NOW - 3 * HOUR
for (let i = 0; i < 9; i++) {
  cursor -= between(4 * HOUR, 30 * HOUR)
  addMessage({
    id: `msg-spam-${String(i + 1).padStart(3, '0')}`,
    alias_id: i % 2 === 0 ? 'alias-hello' : 'alias-work',
    folder: 'spam',
    direction: 'inbound',
    from_addr: `promo-${i + 1}@noise.biz`,
    to_addrs: [addressOf(i % 2 === 0 ? 'alias-hello' : 'alias-work')],
    subject: SPAM_SUBJECTS[i % SPAM_SUBJECTS.length],
    text_body: '本地样本：用于查看垃圾邮件列表与自动清理设置的效果。',
    is_read: 0,
    created_at: cursor,
    deleted_at: cursor + between(30 * MINUTE, 12 * HOUR),
  })
}

// ------------------------------------------------------------------ api keys

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')

/** Plaintext secrets are committed on purpose: local-only fixtures. */
const API_KEYS = [
  {
    id: 'apikey-demo-hello',
    name: 'local-demo',
    secret: 'mfp_live_local_demo_secret_key_do_not_use_prod',
    alias_id: 'alias-hello',
    enabled: 1,
    hourly_limit: 30,
    daily_limit: 200,
    created_at: NOW - 12 * DAY,
  },
  {
    id: 'apikey-demo-shop',
    name: 'shop-checkout',
    secret: 'mfp_live_shop_demo_secret_key_aaaaaaaaaaaaaa',
    alias_id: 'alias-work',
    enabled: 1,
    hourly_limit: 60,
    daily_limit: 500,
    created_at: NOW - 6 * DAY,
  },
  {
    id: 'apikey-demo-disabled',
    name: 'old-blog-integration',
    secret: 'mfp_live_oldblog_secret_key_disabled_example',
    alias_id: 'alias-blog',
    enabled: 0,
    hourly_limit: 10,
    daily_limit: 50,
    created_at: NOW - 25 * DAY,
  },
]

const apiKeyRows = API_KEYS.map((key) => ({
  id: key.id,
  name: key.name,
  key_prefix: `mfp_live_${key.secret.slice('mfp_live_'.length, 'mfp_live_'.length + 8)}`,
  key_hash: sha256Hex(key.secret),
  alias_id: key.alias_id,
  enabled: key.enabled,
  hourly_limit: key.hourly_limit,
  daily_limit: key.daily_limit,
  created_at: key.created_at,
}))

const LOG_SUBJECTS = [
  '欢迎注册，请验证邮箱',
  '重置密码',
  `订单 #${1042} 已确认`,
  '发货通知',
  '收据',
  '登录验证码',
]
const ERROR_CODES = ['invalid_address', 'provider_error', 'quota_exceeded']

const sendLogs = []
let logCursor = NOW - 12 * MINUTE
for (let i = 0; i < 48; i++) {
  // Front-load the first 18 rows into the last 24h so the usage panel has both
  // a 24h and a 7d/30d picture.
  logCursor -= i < 18 ? between(20 * MINUTE, 80 * MINUTE) : between(3 * HOUR, 30 * HOUR)
  const key = API_KEYS[i % 2 === 0 ? 0 : 1]
  const failed = chance(0.18)
  sendLogs.push({
    id: `log-${String(i + 1).padStart(3, '0')}`,
    api_key_id: key.id,
    from_addr: addressOf(key.alias_id),
    to_addrs: JSON.stringify([`user${i + 1}@customers.example`]),
    subject: pick(LOG_SUBJECTS),
    status: failed ? 'failed' : 'sent',
    error_code: failed ? pick(ERROR_CODES) : null,
    provider_message_id: failed ? null : `re_seed_log_${2000 + i}`,
    created_at: logCursor,
  })
}

const windowStart = Math.floor(NOW / HOUR) * HOUR
const usageRows = [
  { api_key_id: 'apikey-demo-hello', window_start: windowStart, count: 4 },
  { api_key_id: 'apikey-demo-hello', window_start: windowStart - HOUR, count: 7 },
  { api_key_id: 'apikey-demo-shop', window_start: windowStart, count: 11 },
  { api_key_id: 'apikey-demo-shop', window_start: windowStart - 2 * HOUR, count: 3 },
]

// ----------------------------------------------------------------- assemble

function adminSql() {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(ADMIN_PASSWORD, salt, PBKDF2_ITERATIONS, 32, 'sha256')
  const encoded = `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`
  return (
    `DELETE FROM users WHERE username = ${sql(ADMIN_USERNAME)};\n\n` +
    insertMany(
      'users',
      ['id', 'username', 'password_hash', 'display_name', 'created_at'],
      [
        {
          id: 'user-local-admin',
          username: ADMIN_USERNAME,
          password_hash: encoded,
          display_name: '本地管理员',
          created_at: NOW - 45 * DAY,
        },
      ],
    )
  )
}

const parts = [
  `-- Generated by scripts/seed-local.mjs — do not edit, re-run the script instead.`,
  `-- domain: ${DOMAIN}    generated: ${new Date(NOW).toISOString()}`,
  '',
  '-- Child rows first: message_tags/api_* reference messages and aliases.',
  'DELETE FROM message_tags;',
  'DELETE FROM api_send_logs;',
  'DELETE FROM api_key_usage;',
  'DELETE FROM api_keys;',
  'DELETE FROM filters;',
  'DELETE FROM tags;',
  'DELETE FROM messages;',
  'DELETE FROM aliases;',
  'DELETE FROM mailbox_settings;',
  '',
  insertMany(
    'mailbox_settings',
    ['id', 'trash_retention_days', 'spam_retention_days'],
    [{ id: 1, trash_retention_days: 30, spam_retention_days: 30 }],
  ),
  '',
  flag('admin') ? adminSql() : '',
  insertMany(
    'aliases',
    ['id', 'address', 'enabled', 'is_default', 'created_at'],
    ALIASES.map((alias) => ({
      id: alias.id,
      address: addressOf(alias.id),
      enabled: alias.enabled,
      is_default: alias.isDefault,
      created_at: NOW - alias.ageDays * DAY,
    })),
  ),
  insertMany(
    'tags',
    ['id', 'name', 'color', 'created_at'],
    TAGS.map((tag, i) => ({ ...tag, created_at: NOW - (30 - i) * DAY })),
  ),
  insertMany(
    'filters',
    ['id', 'name', 'enabled', 'priority', 'match_mode', 'conditions_json', 'actions_json', 'created_at'],
    FILTERS.map((filter, i) => ({
      id: filter.id,
      name: filter.name,
      enabled: filter.enabled,
      priority: filter.priority,
      match_mode: filter.match_mode,
      conditions_json: JSON.stringify(filter.conditions),
      actions_json: JSON.stringify(filter.actions),
      created_at: NOW - (20 - i) * DAY,
    })),
  ),
  insertMany(
    'messages',
    [
      'id',
      'alias_id',
      'folder',
      'direction',
      'from_addr',
      'to_addrs',
      'subject',
      'text_body',
      'html_body',
      'is_read',
      'is_starred',
      'provider_message_id',
      'has_unsupported_attachments',
      'last_error_code',
      'created_at',
      'deleted_at',
    ],
    messages,
    20,
  ),
  insertMany('message_tags', ['message_id', 'tag_id'], messageTags),
  insertMany(
    'api_keys',
    ['id', 'name', 'key_prefix', 'key_hash', 'alias_id', 'enabled', 'hourly_limit', 'daily_limit', 'created_at'],
    apiKeyRows,
  ),
  insertMany(
    'api_send_logs',
    ['id', 'api_key_id', 'from_addr', 'to_addrs', 'subject', 'status', 'error_code', 'provider_message_id', 'created_at'],
    sendLogs,
  ),
  insertMany('api_key_usage', ['api_key_id', 'window_start', 'count'], usageRows),
]

const script = parts.filter(Boolean).join('\n')

mkdirSync('.wrangler/tmp', { recursive: true })
writeFileSync(OUT_PATH, script)

// Wrangler echoes one JSON result block per statement, which buries the summary.
function runWrangler(wranglerArgs) {
  const options = { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }
  try {
    execFileSync('wrangler', wranglerArgs, options)
  } catch (error) {
    if (error.code === 'ENOENT') {
      execFileSync('npx', ['wrangler', ...wranglerArgs], options)
      return
    }
    process.stdout.write(error.stdout ?? '')
    throw error
  }
}

const byFolder = messages.reduce((acc, m) => {
  acc[m.folder] = (acc[m.folder] ?? 0) + 1
  return acc
}, {})

console.log(`[seed] domain: ${DOMAIN}`)
console.log(`[seed] SQL written to ${OUT_PATH}`)

if (flag('print')) {
  console.log('[seed] --print given, not applying to D1')
  process.exit(0)
}

runWrangler(['d1', 'execute', 'DB', '--local', `--file=${OUT_PATH}`])

console.log('')
console.log(
  `[seed] aliases ${ALIASES.length} · tags ${TAGS.length} · filters ${FILTERS.length} · ` +
    `messages ${messages.length} (inbox ${byFolder.inbox}, sent ${byFolder.sent}, ` +
    `draft ${byFolder.draft}, trash ${byFolder.trash}, spam ${byFolder.spam}) · ` +
    `tag links ${messageTags.length} · ` +
    `api keys ${API_KEYS.length} · send logs ${sendLogs.length}`,
)
if (flag('admin')) {
  console.log(`[seed] login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`)
}
console.log('[seed] API key secrets (local only):')
for (const key of API_KEYS) {
  console.log(`         ${key.name}${key.enabled ? '' : ' (disabled)'}: ${key.secret}`)
}
