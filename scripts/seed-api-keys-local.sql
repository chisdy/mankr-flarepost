-- Local demo API keys + send logs (run after aliases exist, e.g. after seed-local.sql)
-- Known plaintext secrets (local only — never use in production):
--   mfp_live_local_demo_secret_key_do_not_use_prod  → noreply-style (hello@)
--   mfp_live_shop_demo_secret_key_aaaaaaaaaaaaaa     → shop (work@)

DELETE FROM api_send_logs;
DELETE FROM api_key_usage;
DELETE FROM api_keys;

INSERT INTO api_keys (
  id, name, key_prefix, key_hash, alias_id, enabled,
  hourly_limit, daily_limit, created_at
) VALUES
  (
    'apikey-demo-hello',
    'local-demo',
    'mfp_live_local_de',
    'cae07b06f45b79102b76471a6c36e82c31db91b6707b5c48059760848a4b4184',
    'alias-hello',
    1,
    30,
    200,
    strftime('%s','now') * 1000 - 86400000 * 2
  ),
  (
    'apikey-demo-shop',
    'shop-checkout',
    'mfp_live_shop_dem',
    '919502c475abf206facad748cdf4492e529a6eb410442aba17990236d4548d84',
    'alias-work',
    1,
    60,
    500,
    strftime('%s','now') * 1000 - 86400000
  ),
  (
    'apikey-demo-disabled',
    'old-blog-integration',
    'mfp_live_oldblog_',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'alias-blog',
    0,
    10,
    50,
    strftime('%s','now') * 1000 - 86400000 * 5
  );

-- Recent successful / failed sends for usage UI (24h + 7d)
INSERT INTO api_send_logs (
  id, api_key_id, from_addr, to_addrs, subject, status,
  error_code, provider_message_id, created_at
) VALUES
  (
    'log-1', 'apikey-demo-hello', 'hello@example.com',
    '["user@example.com"]', 'Welcome code', 'sent',
    NULL, 're_seed_1', strftime('%s','now') * 1000 - 3600000
  ),
  (
    'log-2', 'apikey-demo-hello', 'hello@example.com',
    '["alice@example.com"]', 'Password reset', 'sent',
    NULL, 're_seed_2', strftime('%s','now') * 1000 - 7200000
  ),
  (
    'log-3', 'apikey-demo-hello', 'hello@example.com',
    '["bad@invalid"]', 'Failed send', 'failed',
    'invalid_address', NULL, strftime('%s','now') * 1000 - 5400000
  ),
  (
    'log-4', 'apikey-demo-shop', 'work@example.com',
    '["buyer@shop.test"]', 'Order #1042 confirmed', 'sent',
    NULL, 're_seed_3', strftime('%s','now') * 1000 - 1800000
  ),
  (
    'log-5', 'apikey-demo-shop', 'work@example.com',
    '["buyer@shop.test"]', 'Shipping update', 'sent',
    NULL, 're_seed_4', strftime('%s','now') * 1000 - 86400000 * 3
  ),
  (
    'log-6', 'apikey-demo-shop', 'work@example.com',
    '["buyer@shop.test"]', 'Receipt', 'failed',
    'provider_error', NULL, strftime('%s','now') * 1000 - 86400000 * 2
  );

-- Quota counters so soft-limit path is visible in DB
INSERT INTO api_key_usage (api_key_id, window_start, count) VALUES
  (
    'apikey-demo-hello',
    CAST((strftime('%s','now') / 3600) AS INTEGER) * 3600 * 1000,
    2
  ),
  (
    'apikey-demo-shop',
    CAST((strftime('%s','now') / 3600) AS INTEGER) * 3600 * 1000,
    1
  );
