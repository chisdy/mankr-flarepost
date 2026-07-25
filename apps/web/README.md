# @mankr/web

Vite + React SPA for Mankr Flarepost (shadcn preset `b39gyV42i`).

## Free-tier boundaries (P0)

- **Aliases:** max **5** per installation
- **Attachments:** R2-backed; download inbound; compose upload; outbound via Resend
- **Users:** single admin account
- **Outbound:** Cloudflare arbitrary send needs Paid; Total Free path uses `SEND_CHANNEL=resend`

## Dev

```bash
pnpm --filter @mankr/web dev
```

Proxies `/api` to `http://127.0.0.1:8787`.
