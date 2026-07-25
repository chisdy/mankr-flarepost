export type UserRow = {
  id: string
  username: string
  password_hash: string
  display_name: string | null
  created_at: number
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  return row?.n ?? 0
}

export async function findUserByUsername(
  db: D1Database,
  username: string,
): Promise<UserRow | null> {
  return db
    .prepare(
      'SELECT id, username, password_hash, display_name, created_at FROM users WHERE username = ?',
    )
    .bind(username)
    .first<UserRow>()
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(
      'SELECT id, username, password_hash, display_name, created_at FROM users WHERE id = ?',
    )
    .bind(id)
    .first<UserRow>()
}

/** Bootstrap insert: succeeds only when users is empty (race-safe single-user constraint). */
export async function insertUser(
  db: D1Database,
  user: {
    id: string
    username: string
    passwordHash: string
    displayName: string | null
    createdAt: number
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, display_name, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM users) = 0`,
    )
    .bind(user.id, user.username, user.passwordHash, user.displayName, user.createdAt)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function updateUserPassword(
  db: D1Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(passwordHash, userId)
    .run()
}
