-- Stars, tags, filters (SQLite cannot ALTER CHECK constraints; rebuild messages for is_starred)
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
  is_starred INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  has_unsupported_attachments INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO messages_new (
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, is_starred, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
)
SELECT
  id, alias_id, folder, direction, from_addr, to_addrs, subject,
  text_body, html_body, is_read, 0, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX idx_messages_folder_created ON messages(folder, created_at DESC);
CREATE INDEX idx_messages_alias_folder_created ON messages(alias_id, folder, created_at DESC);
CREATE INDEX idx_messages_starred_created ON messages(is_starred, created_at DESC);

CREATE TABLE tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE message_tags (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, tag_id)
);

CREATE INDEX idx_message_tags_tag ON message_tags(tag_id);

CREATE TABLE filters (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  match_mode TEXT NOT NULL CHECK (match_mode IN ('and', 'or')),
  conditions_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_filters_priority ON filters(priority ASC, created_at ASC);

PRAGMA foreign_keys=ON;
