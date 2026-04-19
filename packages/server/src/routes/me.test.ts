import { describe, expect, it } from 'vitest'
import type { AuthProvider } from '@brandfactory/adapter-auth'
import { createApp } from '../app'
import { createFakeAdapters, createTestApp, silentLogger, testEnv } from '../test-helpers'

describe('GET /me', () => {
  it('returns the user row on happy path', async () => {
    const { app } = createTestApp({ users: [{ id: 'u-1', token: 't-1' }] })
    const res = await app.request('/me', { headers: { authorization: 'Bearer t-1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'u-1', email: 'u-1@example.com' })
  })

  it('404s when the auth provider has no matching user', async () => {
    const auth: AuthProvider = {
      async verifyToken() {
        return { userId: 'ghost' }
      },
      async getUserById() {
        return null
      },
    }
    const adapters = createFakeAdapters({ auth })
    const app = createApp({ ...adapters, env: testEnv(), log: silentLogger() })
    const res = await app.request('/me', { headers: { authorization: 'Bearer x' } })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'USER_NOT_FOUND' })
  })

  it('401s when no bearer token is present', async () => {
    const { app } = createTestApp({ users: [{ id: 'u-1', token: 't-1' }] })
    const res = await app.request('/me')
    expect(res.status).toBe(401)
  })
})
