-- Archive is a view of inbound mail. Keep the physical inbox folder to avoid
-- rebuilding messages and its dependent tables to change the folder CHECK.
ALTER TABLE messages ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
ALTER TABLE messages ADD COLUMN move_revision INTEGER NOT NULL DEFAULT 0;

-- Track every move, including older single-message routes and inbox rules.
-- Other edits (read state, stars, tags) do not invalidate an undo.
CREATE TRIGGER messages_move_revision
AFTER UPDATE OF folder, is_archived ON messages
WHEN OLD.folder <> NEW.folder OR OLD.is_archived <> NEW.is_archived
BEGIN
  UPDATE messages SET move_revision = OLD.move_revision + 1 WHERE id = NEW.id;
END;

CREATE TABLE message_move_undo (
  token TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  previous_folder TEXT NOT NULL,
  previous_archive INTEGER NOT NULL,
  previous_deleted_at INTEGER,
  revision INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (token, message_id)
);
CREATE INDEX idx_message_move_undo_expires ON message_move_undo(expires_at);
CREATE INDEX idx_message_move_undo_message ON message_move_undo(message_id);

DROP INDEX idx_messages_folder_created;
CREATE INDEX idx_messages_folder_page ON messages(folder, created_at DESC, id DESC);
CREATE INDEX idx_messages_inbox_page ON messages(is_archived, created_at DESC, id DESC)
  WHERE folder = 'inbox';
DROP INDEX idx_messages_starred_created;
CREATE INDEX idx_messages_starred_page ON messages(is_starred, created_at DESC, id DESC);
CREATE INDEX idx_messages_visible_alias_page ON messages(alias_id, created_at DESC, id DESC)
  WHERE folder NOT IN ('trash', 'draft', 'spam');
