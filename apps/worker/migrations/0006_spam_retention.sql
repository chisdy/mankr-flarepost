-- Spam folder + retention settings. SQLite cannot ALTER a CHECK constraint, so `messages`
-- has to be rebuilt to widen `folder` to include 'spam'.
--
-- `PRAGMA foreign_keys=OFF` cannot be used here: D1 runs every migration inside an implicit
-- transaction, and SQLite ignores that pragma inside a transaction. `defer_foreign_keys`
-- only postpones constraint *checks* — it does not suppress ON DELETE CASCADE actions, and
-- DROP TABLE performs an implicit DELETE FROM while foreign keys are enforced. Dropping
-- `messages` directly would therefore cascade away every row of `message_tags`.
--
-- So the cascade is detached before the rebuild and reattached afterwards.
PRAGMA defer_foreign_keys = ON;

-- 1. DETACH: same rows, but `messages` is referenced with NO ACTION so the rebuild below
--    cannot cascade into this table. The violation this opens is deferred to COMMIT, by
--    which point `messages` has been rebuilt with every id intact.
CREATE TABLE message_tags_detached (
  message_id TEXT NOT NULL REFERENCES messages(id),
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, tag_id)
);

INSERT INTO message_tags_detached (message_id, tag_id)
SELECT message_id, tag_id FROM message_tags;

DROP TABLE message_tags;
ALTER TABLE message_tags_detached RENAME TO message_tags;

-- 2. REBUILD: widen the folder CHECK constraint to allow 'spam'.
CREATE TABLE messages_new (
  id TEXT PRIMARY KEY NOT NULL,
  alias_id TEXT NOT NULL REFERENCES aliases(id),
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'trash', 'draft', 'spam')),
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
  text_body, html_body, is_read, is_starred, provider_message_id,
  has_unsupported_attachments, last_error_code, created_at, deleted_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX idx_messages_folder_created ON messages(folder, created_at DESC);
CREATE INDEX idx_messages_alias_folder_created ON messages(alias_id, folder, created_at DESC);
CREATE INDEX idx_messages_starred_created ON messages(is_starred, created_at DESC);
-- Retention purge scans trash/spam by soft-delete timestamp.
CREATE INDEX idx_messages_folder_deleted ON messages(folder, deleted_at);

-- 3. REATTACH: restore ON DELETE CASCADE now that `messages` exists again.
CREATE TABLE message_tags_new (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, tag_id)
);

INSERT INTO message_tags_new (message_id, tag_id)
SELECT message_id, tag_id FROM message_tags;

DROP TABLE message_tags;
ALTER TABLE message_tags_new RENAME TO message_tags;

CREATE INDEX idx_message_tags_tag ON message_tags(tag_id);

-- Single-row settings for the single-user mailbox.
CREATE TABLE mailbox_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  trash_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (trash_retention_days BETWEEN 1 AND 90),
  spam_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (spam_retention_days BETWEEN 1 AND 90)
);

INSERT INTO mailbox_settings (id) VALUES (1);

PRAGMA defer_foreign_keys = OFF;
