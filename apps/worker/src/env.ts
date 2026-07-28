export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  COOKIES_SECRET: string
  EMAIL_DOMAIN: string
  /** Active provider when mailbox_settings.send_provider is NULL. */
  SEND_PROVIDER?: string
  RESEND_API_KEY?: string
  BREVO_API_KEY?: string
  MAILEROO_API_KEY?: string
  /** Both are needed to read Cloudflare usage; either alone is unusable. */
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
}
