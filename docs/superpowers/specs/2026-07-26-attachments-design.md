# Attachments (R2) — Design

Date: 2026-07-26  
Status: approved via prior plan + “继续执行下一步”

## Goal

Inbound store + download; compose upload + outbound send (Resend). Stay within Cloudflare free-tier expectations.

## Decisions

| Item | Choice |
|------|--------|
| Storage | R2 binding `ATTACHMENTS` |
| Metadata | D1 `attachments` table |
| Per-file max | **5 MiB** |
| Per-message max count | **5** |
| Per-message total | **10 MiB** |
| Outbound with files | **Resend only**; Cloudflare / Mailchannels → `attachments_unsupported` |
| Inline images | Treated as attachments if disposition=attachment; related/inline still stored when present as attachment parts |
| Skipped (over limit) | Message kept; `has_unsupported_attachments=1` for skipped remainder |

## Schema

```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT,              -- NULL = pending (compose upload)
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);
CREATE INDEX idx_attachments_message ON attachments(message_id);
```

R2 key: `att/{yyyy}/{id}`

## API

- `POST /api/attachments` multipart `file` (+ optional `messageId` for draft)
- `GET /api/messages/:id/attachments` → metadata list
- `GET /api/attachments/:id` → download stream
- `DELETE /api/attachments/:id` → remove pending or draft-linked
- Send / draft bodies accept `attachmentIds: string[]`

## Cleanup

- Delete draft → delete rows + R2 objects for that message
- Empty trash → delete attachments for trashed messages + R2
- Orphan pending left until user deletes (acceptable for single-user)

## UI

- Message detail: download links; banner only if some were skipped
- Compose: file picker, list, remove; send includes ids
