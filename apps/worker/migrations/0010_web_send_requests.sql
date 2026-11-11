ALTER TABLE messages ADD COLUMN reply_to_addrs TEXT NOT NULL DEFAULT '[]';

CREATE TABLE web_send_requests (
  id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  draft_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('processing', 'accepted_pending', 'accepted', 'failed', 'unknown')),
  provider_message_id TEXT,
  error_code TEXT,
  pending_payload TEXT,
  created_at INTEGER NOT NULL
);

-- A lost response can outlive the draft or browser tab. Never expire an unresolved
-- claim into a new send or let a second tab send the same draft with another key.
CREATE UNIQUE INDEX idx_web_send_requests_active_draft
  ON web_send_requests(draft_id)
  WHERE draft_id IS NOT NULL AND state <> 'failed';
