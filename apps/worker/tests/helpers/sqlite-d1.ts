import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Runs production SQL and migrations with real SQLite constraints and transactions. */
export function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const dir = fileURLToPath(new URL('../../migrations/', import.meta.url))
  for (const file of readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(`${dir}/${file}`, 'utf8'))
  }
  class Statement {
    constructor(
      readonly sql: string,
      readonly args: (string | number | null)[] = [],
    ) {}
    bind(...args: (string | number | null)[]) {
      return new Statement(this.sql, args)
    }
    async first<T>() {
      return (sqlite.prepare(this.sql).all(...this.args)[0] ?? null) as T | null
    }
    async all<T>() {
      return {
        success: true,
        results: sqlite.prepare(this.sql).all(...this.args) as T[],
      }
    }
    execute() {
      const totalChanges = () => Number(sqlite.prepare('SELECT total_changes() AS n').get()!.n)
      const before = totalChanges()
      const results = sqlite.prepare(this.sql).all(...this.args)
      return {
        success: true,
        results,
        meta: { changes: totalChanges() - before },
      }
    }
    async run() {
      return this.execute()
    }
  }
  const db = {
    prepare(sql: string) {
      return new Statement(sql)
    },
    async batch(statements: Statement[]) {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.execute())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { db, sqlite }
}
