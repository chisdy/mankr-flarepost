-- HTTP idempotency only. Never stores email bodies or plaintext credentials.
CREATE TABLE api_send_requests (
  id TEXT PRIMARY KEY NOT NULL,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  idempotency_key_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'accepted', 'failed', 'unknown')),
  provider TEXT,
  provider_message_id TEXT,
  log_id TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (api_key_id, idempotency_key_hash)
);
CREATE INDEX idx_api_send_requests_expiry ON api_send_requests(expires_at);
CREATE INDEX idx_api_send_logs_page ON api_send_logs(created_at DESC, id DESC);
