/**
 * Init admin helper (offline / docs).
 *
 * Preferred bootstrap path (one-click): POST /api/setup when users table is empty.
 *
 *   curl -X POST http://127.0.0.1:8787/api/setup \
 *     -H 'content-type: application/json' \
 *     -d '{"username":"admin","password":"changeme1","displayName":"Admin"}'
 *
 * This script prints a D1 SQL insert using env ADMIN_USERNAME / ADMIN_PASSWORD
 * (and optional ADMIN_DISPLAY_NAME). It refuses to invent SQL if a user may
 * already exist — apply only against an empty users table.
 *
 * Usage:
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD='changeme1' \
 *     pnpm --filter @mankr/worker exec tsx scripts/init-admin.ts
 *
 * Then apply with wrangler, e.g.:
 *   pnpm init:admin
 *   # or paste the printed SQL into:
 *   # wrangler d1 execute DB --local --command "..."
 */

import { hashPassword } from '../src/auth/password'

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || null

  if (!username || !password) {
    console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters')
    process.exit(1)
  }

  const id = crypto.randomUUID()
  const passwordHash = await hashPassword(password)
  const createdAt = Date.now()
  const displaySql = displayName === null ? 'NULL' : `'${displayName.replace(/'/g, "''")}'`
  const usernameSql = username.replace(/'/g, "''")
  const hashSql = passwordHash.replace(/'/g, "''")

  const sql = [
    `-- Refuse if any user already exists:`,
    `SELECT CASE WHEN COUNT(*) > 0 THEN RAISE(ABORT, 'user already present') END FROM users;`,
    `INSERT INTO users (id, username, password_hash, display_name, created_at)`,
    `VALUES ('${id}', '${usernameSql}', '${hashSql}', ${displaySql}, ${createdAt});`,
  ].join('\n')

  console.log(sql)
  console.log('')
  console.log('Preferred: POST /api/setup when COUNT(users)=0 (returns 403 if already initialized).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
