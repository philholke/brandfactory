import type { UserId } from '@brandfactory/shared'
import { eq } from 'drizzle-orm'
import { db } from '../client'
import { users } from '../schema'

// Users aren't exposed via shared yet (Phase 3 adapters own the auth shape).
// V1 returns the row verbatim for internal callers.
export type User = typeof users.$inferSelect

export async function getUserById(id: UserId): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id))
  return row ?? null
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email))
  return row ?? null
}

export async function createUser(input: {
  email: string
  displayName?: string | null
}): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      displayName: input.displayName ?? null,
    })
    .returning()
  if (!row) throw new Error('createUser returned no row')
  return row
}
