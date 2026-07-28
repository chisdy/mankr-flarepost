-- Per-provider send accounting for the usage page.
--
-- Two independent sources are kept apart on purpose, because neither can replace the other:
--   * `send_usage_events` is what this app observed itself. Always current, but it only knows
--     about mail sent through this worker.
--   * `provider_quota_reports` is what the provider last told us about its own tally. It
--     covers traffic this app cannot see, but only refreshes when we send something.
-- The usage page shows the larger of the two and names which source produced it.
--
-- `provider` is intentionally free-form text with no CHECK constraint: adding a second
-- sending service should not require a migration.

CREATE TABLE send_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  -- Providers count each recipient separately, so one API call can consume several units.
  units INTEGER NOT NULL CHECK (units > 0),
  sent_at INTEGER NOT NULL
);

-- Every read filters by provider over a day or month window.
CREATE INDEX idx_send_usage_events_provider_sent ON send_usage_events(provider, sent_at);

CREATE TABLE provider_quota_reports (
  provider TEXT PRIMARY KEY NOT NULL,
  -- NULL means the provider did not report that window; it never means zero.
  daily_used INTEGER,
  monthly_used INTEGER,
  captured_at INTEGER NOT NULL
);
