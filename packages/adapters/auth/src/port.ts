import type { User } from '@brandfactory/db'

// Identity-provider port. Two methods only:
//   - verifyToken: validate an opaque bearer token and resolve the user id
//   - getUserById: resolve our `users` row from the id surfaced by verifyToken
//
// Listing users intentionally stays off the port — that's a DB read against
// our `users` table, not an identity-provider concern. Putting it here would
// hide the difference between our table and (e.g.) Supabase Auth's
// `auth.users`. Callers that need a roster import from `@brandfactory/db`.
export interface AuthProvider {
  verifyToken(token: string): Promise<{ userId: string }>
  getUserById(id: string): Promise<User | null>
}

export class InvalidTokenError extends Error {
  constructor(message = 'invalid token') {
    super(message)
    this.name = 'InvalidTokenError'
  }
}

export type { User }
