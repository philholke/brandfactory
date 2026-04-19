import type { AuthProvider } from '@brandfactory/adapter-auth'
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { NotFoundError, UnauthorizedError } from '../errors'

export interface MeDeps {
  auth: AuthProvider
}

export function createMeRouter(deps: MeDeps) {
  return new Hono<AppEnv>().get('/', async (c) => {
    const userId = c.var.userId
    if (!userId) throw new UnauthorizedError()
    const user = await deps.auth.getUserById(userId)
    if (!user) throw new NotFoundError('user not found', 'USER_NOT_FOUND')
    return c.json(user)
  })
}
