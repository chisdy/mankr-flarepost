-- Add draft folder support (SQLite cannot ALTER CHECK constraints)
PRAGMA foreign_keys=OFF;

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY NOT NULL,
  alias_id TEXT NOT NULL REFERENCES aliases(id),
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'trash', 'draft')),
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

INSERT INTO messages_new (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
)
SELECT
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX idx_messages_folder_created ON messages(folder, created_at DESC);
CREATE INDEX idx_messages_alias_folder_created ON messages(alias_id, folder, created_at DESC);

PRAGMA foreign_keys=ON;
