import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Lazy singleton: the pool / drizzle instance are constructed on first
// access, not at module import. Lets test runners and tooling import
// `@brandfactory/db` (e.g. for the `User` row type) without DATABASE_URL
// being set. Real query helpers still throw if no connection string is
// configured by the time they run.

let _pool: Pool | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }
  return new Pool({ connectionString })
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    _pool ??= makePool()
    const value = (_pool as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(_pool) : value
  },
}) as Pool

export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy(
  {} as ReturnType<typeof drizzle<typeof schema>>,
  {
    get(_target, prop) {
      if (!_db) {
        _pool ??= makePool()
        _db = drizzle(_pool, { schema })
      }
      const value = (_db as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(_db) : value
    },
  },
) as ReturnType<typeof drizzle<typeof schema>>
