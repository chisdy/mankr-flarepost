export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  COOKIES_SECRET: string
  EMAIL_DOMAIN: string
  RESEND_API_KEY?: string
}
