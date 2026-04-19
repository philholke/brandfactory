import type { UserId } from '@brandfactory/shared'
import { getUserById as dbGetUserById, type User } from '@brandfactory/db'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { type AuthProvider, InvalidTokenError } from './port'

export interface SupabaseAuthConfig {
  jwksUrl: string
  audience?: string
  issuer?: string
}

export interface SupabaseAuthDeps {
  getUserById?: (id: string) => Promise<User | null>
  // Test seam: substitute a JWKS resolver instead of fetching one.
  jwks?: JWTVerifyGetKey
}

export function createSupabaseAuthProvider(
  config: SupabaseAuthConfig,
  deps: SupabaseAuthDeps = {},
): AuthProvider {
  const jwks = deps.jwks ?? createRemoteJWKSet(new URL(config.jwksUrl))
  const lookup = deps.getUserById ?? ((id: string) => dbGetUserById(id as UserId))

  return {
    async verifyToken(token: string) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          audience: config.audience,
          issuer: config.issuer,
        })
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          throw new InvalidTokenError('jwt missing sub claim')
        }
        return { userId: payload.sub }
      } catch (err) {
        if (err instanceof InvalidTokenError) throw err
        const msg = err instanceof Error ? err.message : 'jwt verification failed'
        throw new InvalidTokenError(`jwt verification failed: ${msg}`)
      }
    },
    async getUserById(id: string) {
      return lookup(id)
    },
  }
}
