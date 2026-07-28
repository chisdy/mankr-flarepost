-- Active outbound provider (NULL = follow env SEND_PROVIDER / default resend) and
-- encrypted per-provider API keys. Retention UPSERT must never rewrite send_provider.
ALTER TABLE mailbox_settings ADD COLUMN send_provider TEXT
  CHECK (send_provider IS NULL OR send_provider IN ('resend', 'brevo', 'maileroo'));

CREATE TABLE send_provider_secrets (
  provider TEXT PRIMARY KEY
    CHECK (provider IN ('resend', 'brevo', 'maileroo')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_hint TEXT,
  updated_at INTEGER NOT NULL
);
