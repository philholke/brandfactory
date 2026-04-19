import type { UserId } from '@brandfactory/shared'
import { getUserById as dbGetUserById, type User } from '@brandfactory/db'
import { type AuthProvider, InvalidTokenError } from './port'

// Dev-only auth: the bearer token IS the user id. No crypto, no signing.
// Production callers must wire a real provider (e.g. supabase) instead.

// RFC-4122 v4 UUID. Version nibble = 4; variant nibble ∈ {8,9,a,b}.
// `@brandfactory/db` generates ids via pg's `gen_random_uuid()` which
// always emits v4, so dev tokens must match that shape.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface LocalAuthDeps {
  getUserById?: (id: string) => Promise<User | null>
}

export function createLocalAuthProvider(deps: LocalAuthDeps = {}): AuthProvider {
  const lookup = deps.getUserById ?? ((id: string) => dbGetUserById(id as UserId))

  return {
    async verifyToken(token: string) {
      if (!UUID_RE.test(token)) {
        throw new InvalidTokenError('local auth token is not a uuid')
      }
      const user = await lookup(token)
      if (!user) throw new InvalidTokenError('user not found for token')
      return { userId: user.id }
    },
    async getUserById(id: string) {
      return lookup(id)
    },
  }
}
