import type { UserId } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

describe('workspaces routes', () => {
  it('POST /workspaces creates a workspace owned by the authed user', async () => {
    const { app } = createTestApp({ users: [{ id: 'u-1', token: 't-1' }] })
    const res = await app.request('/workspaces', {
      method: 'POST',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; ownerUserId: string; name: string }
    expect(body.name).toBe('Acme')
    expect(body.ownerUserId).toBe('u-1')
  })

  it('GET /workspaces returns only mine', async () => {
    const { app, state } = createTestApp({ users: [{ id: 'u-1', token: 't-1' }] })
    state.workspaces.set('w-mine', {
      id: 'w-mine' as never,
      name: 'mine',
      ownerUserId: 'u-1' as UserId,
      createdAt: 't',
      updatedAt: 't',
    })
    state.workspaces.set('w-theirs', {
      id: 'w-theirs' as never,
      name: 'theirs',
      ownerUserId: 'u-2' as UserId,
      createdAt: 't',
      updatedAt: 't',
    })
    const res = await app.request('/workspaces', {
      headers: { authorization: 'Bearer t-1' },
    })
    expect(res.status).toBe(200)
    const list = (await res.json()) as Array<{ id: string }>
    expect(list.map((w) => w.id)).toEqual(['w-mine'])
  })

  it('GET /workspaces/:id forbids a non-owner', async () => {
    const { app, state } = createTestApp({
      users: [
        { id: 'u-1', token: 't-1' },
        { id: 'u-2', token: 't-2' },
      ],
    })
    state.workspaces.set('w-theirs', {
      id: 'w-theirs' as never,
      name: 'theirs',
      ownerUserId: 'u-2' as UserId,
      createdAt: 't',
      updatedAt: 't',
    })
    const res = await app.request('/workspaces/w-theirs', {
      headers: { authorization: 'Bearer t-1' },
    })
    expect(res.status).toBe(403)
  })

  it('POST /workspaces rejects an empty name with 400 VALIDATION', async () => {
    const { app } = createTestApp({ users: [{ id: 'u-1', token: 't-1' }] })
    const res = await app.request('/workspaces', {
      method: 'POST',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })
})
