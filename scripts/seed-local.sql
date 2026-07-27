-- Local demo seed for UI walkthrough (EMAIL_DOMAIN=example.com)
-- Safe to re-run only after clearing aliases/messages, or on empty tables.
-- Clears API-key tables first (they reference aliases).

DELETE FROM api_send_logs;
DELETE FROM api_key_usage;
DELETE FROM api_keys;
DELETE FROM messages;
DELETE FROM aliases;

-- Aliases (4/5 — leave one slot so you can test create + limit)
INSERT INTO aliases (id, address, enabled, is_default, created_at) VALUES
  ('alias-hello', 'hello@example.com', 1, 1, strftime('%s','now') * 1000 - 86400000 * 4),
  ('alias-work',  'work@example.com',  1, 0, strftime('%s','now') * 1000 - 86400000 * 3),
  ('alias-blog',  'blog@example.com',  1, 0, strftime('%s','now') * 1000 - 86400000 * 2),
  ('alias-old',   'old@example.com',   0, 0, strftime('%s','now') * 1000 - 86400000 * 1);

-- Inbox: unread plain
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-inbox-1', 'alias-hello', 'inbox', 'inbound',
  'alice@friend.dev', '["hello@example.com"]',
  'Welcome to Mankr Flarepost',
  'Hey! This is a plain-text welcome mail so you can check the inbox list and unread styling.',
  NULL, 0, NULL, 0, NULL,
  strftime('%s','now') * 1000 - 3600000 * 2, NULL
);

-- Inbox: unread HTML
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-inbox-2', 'alias-work', 'inbox', 'inbound',
  'pm@startup.io', '["work@example.com"]',
  'Q3 roadmap draft',
  'Please review the Q3 roadmap.',
  '<p>Hi,</p><p>Please review the <strong>Q3 roadmap</strong>.</p><ul><li>Ship aliases</li><li>Ship compose</li><li>Deploy docs</li></ul><p>— PM</p>',
  0, NULL, 0, NULL,
  strftime('%s','now') * 1000 - 3600000, NULL
);

-- Inbox: read + unsupported attachments banner
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-inbox-3', 'alias-blog', 'inbox', 'inbound',
  'photos@camera.club', '["blog@example.com"]',
  'Weekend shoot (has attachment)',
  'Attached are the weekend photos. V1 cannot download attachments — you should see a banner.',
  '<p>Attached are the weekend photos.</p><p><em>V1 cannot download attachments — you should see a banner.</em></p>',
  1, NULL, 1, NULL,
  strftime('%s','now') * 1000 - 86400000, NULL
);

-- Inbox: older read mail (for Load more / sorting feel)
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-inbox-4', 'alias-hello', 'inbox', 'inbound',
  'newsletter@devtools.weekly', '["hello@example.com"]',
  'DevTools Weekly #128',
  'This week: Workers Assets, D1 migrations tips, and free-tier email notes.',
  NULL, 1, NULL, 0, NULL,
  strftime('%s','now') * 1000 - 86400000 * 3, NULL
);

-- Sent
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-sent-1', 'alias-hello', 'sent', 'outbound',
  'hello@example.com', '["bob@example.org"]',
  'Re: coffee next week?',
  'Sure — Thursday afternoon works for me.',
  NULL, 1, 'seed-provider-1', 0, NULL,
  strftime('%s','now') * 1000 - 7200000, NULL
);

INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-sent-2', 'alias-work', 'sent', 'outbound',
  'work@example.com', '["client@acme.com","cc@acme.com"]',
  'Proposal attached note',
  'Sharing the proposal summary. (No real attachment in V1.)',
  NULL, 1, 'seed-provider-2', 0, NULL,
  strftime('%s','now') * 1000 - 86400000 * 2, NULL
);

-- Trash (was inbound)
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-trash-1', 'alias-hello', 'trash', 'inbound',
  'spam@noise.biz', '["hello@example.com"]',
  'You won a prize!!!',
  'Obviously spam — use Restore or Empty trash to verify folder actions.',
  NULL, 1, NULL, 0, NULL,
  strftime('%s','now') * 1000 - 86400000 * 5,
  strftime('%s','now') * 1000 - 3600000
);

-- Trash (was outbound) — restore should go back to sent
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-trash-2', 'alias-blog', 'trash', 'outbound',
  'blog@example.com', '["editor@magazine.com"]',
  'Guest post draft',
  'Draft I deleted by mistake — restore should return this to Sent.',
  NULL, 1, 'seed-provider-3', 0, NULL,
  strftime('%s','now') * 1000 - 86400000 * 4,
  strftime('%s','now') * 1000 - 1800000
);

-- Draft
INSERT INTO messages (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
) VALUES (
  'msg-draft-1', 'alias-hello', 'draft', 'outbound',
  'hello@example.com', '["friend@example.com"]',
  'WIP: weekend plans',
  'Still drafting this… open from Drafts to continue editing.',
  NULL, 1, NULL, 0, NULL,
  strftime('%s','now') * 1000 - 900000, NULL
);
