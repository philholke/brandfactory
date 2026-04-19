import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../context'
import { onError } from './error'
import { createAuthMiddleware, createOptionalAuthMiddleware } from './auth'
import { createFakeAuth } from '../test-helpers'

function makeApp() {
  const auth = createFakeAuth({ 'valid-token': 'user-1' })
  const app = new Hono<AppEnv>()
  app.onError(onError)
  app.use('/protected/*', createAuthMiddleware(auth))
  app.use('/open/*', createOptionalAuthMiddleware(auth))
  app.get('/protected/me', (c) => c.json({ userId: c.var.userId }))
  app.get('/open/me', (c) => c.json({ userId: c.var.userId ?? null }))
  return app
}

describe('auth middleware', () => {
  it('accepts a valid bearer token', async () => {
    const res = await makeApp().request('/protected/me', {
      headers: { authorization: 'Bearer valid-token' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-1' })
  })

  it('rejects a missing header with 401 UNAUTHORIZED', async () => {
    const res = await makeApp().request('/protected/me')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects an invalid token with 401', async () => {
    const res = await makeApp().request('/protected/me', {
      headers: { authorization: 'Bearer nope' },
    })
    expect(res.status).toBe(401)
  })

  it('optionalAuth does not throw when no header is present', async () => {
    const res = await makeApp().request('/open/me')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: null })
  })

  it('optionalAuth attaches userId when a valid token is present', async () => {
    const res = await makeApp().request('/open/me', {
      headers: { authorization: 'Bearer valid-token' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'user-1' })
  })
})
