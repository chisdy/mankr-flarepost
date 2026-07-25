export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  EMAIL?: { send(msg: unknown): Promise<{ messageId?: string }> }
  COOKIES_SECRET: string
  SEND_CHANNEL: 'cloudflare' | 'resend' | 'mailchannels'
  EMAIL_DOMAIN: string
  RESEND_API_KEY?: string
  MAILCHANNELS_API_KEY?: string
  SENDER_EMAIL?: string
}
