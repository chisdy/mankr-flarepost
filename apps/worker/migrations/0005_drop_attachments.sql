-- Drop attachment storage. R2 cannot be enabled without a payment method on the
-- Cloudflare account, which breaks the zero-credit-card Total Free path, so
-- inbound attachments are no longer persisted. 0004 is kept so already-migrated
-- databases stay consistent with the recorded migration history.

DROP INDEX IF EXISTS idx_attachments_message_id;
DROP TABLE IF EXISTS attachments;
