import type { AuthProvider } from '@brandfactory/adapter-auth'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context'
import { UnauthorizedError } from '../errors'

function extractBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1]!.trim() : null
}

// Required auth: missing/invalid → 401 via the error boundary.
export function createAuthMiddleware(auth: AuthProvider) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = extractBearer(c.req.header('authorization'))
    if (!token) {
      throw new UnauthorizedError('missing bearer token')
    }
    try {
      const { userId } = await auth.verifyToken(token)
      c.set('userId', userId)
    } catch {
      // Don't leak the adapter's error message — surface a generic 401.
      throw new UnauthorizedError('invalid token')
    }
    await next()
  })
}

// Optional auth: sets `userId` when a valid token is present, never throws on
// absence. Used on `/health` so an authenticated probe is attributable in
// logs without failing unauthenticated smoke checks.
export function createOptionalAuthMiddleware(auth: AuthProvider) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = extractBearer(c.req.header('authorization'))
    if (token) {
      try {
        const { userId } = await auth.verifyToken(token)
        c.set('userId', userId)
      } catch {
        // Silently ignore invalid tokens on optional paths.
      }
    }
    await next()
  })
}
