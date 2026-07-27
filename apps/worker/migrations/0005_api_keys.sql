-- API keys for outbound business email from external sites (POST /api/v1/send)

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  alias_id TEXT NOT NULL REFERENCES aliases(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  hourly_limit INTEGER NOT NULL DEFAULT 30,
  daily_limit INTEGER NOT NULL DEFAULT 200,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_api_keys_created ON api_keys(created_at DESC);

-- Metadata only: no bodies. Retained 30 days, pruned opportunistically on send.
CREATE TABLE api_send_logs (
  id TEXT PRIMARY KEY NOT NULL,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_code TEXT,
  provider_message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_api_send_logs_key_created ON api_send_logs(api_key_id, created_at DESC);
CREATE INDEX idx_api_send_logs_created ON api_send_logs(created_at);

-- Rate limiting only. Hourly windows, pruned past 48h on send. UI usage stats
-- come from api_send_logs instead.
CREATE TABLE api_key_usage (
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, window_start)
);
