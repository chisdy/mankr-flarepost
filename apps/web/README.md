# @mankr/web

Vite + React SPA for Mankr Flarepost (shadcn preset `b39gyV42i`).

## Free-tier boundaries (P0)

- **Aliases:** max **5** per installation
- **Attachments:** not supported — R2 needs a payment method on the account, so inbound files are dropped and the message shows a banner
- **Users:** single admin account
- **Outbound:** Resend only (free tier, no credit card); requires `RESEND_API_KEY`

## Dev

```bash
pnpm --filter @mankr/web dev
```

Proxies `/api` to `http://127.0.0.1:8787`.
