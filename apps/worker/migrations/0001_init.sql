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
