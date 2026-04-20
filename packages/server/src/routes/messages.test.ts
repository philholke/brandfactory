import type { AgentMessage } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { createTestApp, type TestHarness } from '../test-helpers'

const TOKEN = 't-messages'
const USER_ID = 'u-messages'

interface SeededHarness extends TestHarness {
  projectId: string
}

async function seedProject(): Promise<SeededHarness> {
  const harness = createTestApp({ users: [{ id: USER_ID, token: TOKEN }] })
  const { app } = harness
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  const ws = (await (
    await app.request('/workspaces', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'W' }),
    })
  ).json()) as { id: string }
  const br = (await (
    await app.request(`/workspaces/${ws.id}/brands`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'B' }),
    })
  ).json()) as { id: string }
  const pr = (await (
    await app.request(`/brands/${br.id}/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ kind: 'freeform', name: 'P' }),
    })
  ).json()) as { id: string }
  return { ...harness, projectId: pr.id }
}

describe('GET /projects/:id/messages', () => {
  it('returns 401 without auth', async () => {
    const { app } = await seedProject()
    const res = await app.request('/projects/00000000-0000-4000-8000-000000000001/messages')
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown project', async () => {
    const { app } = await seedProject()
    const res = await app.request('/projects/00000000-0000-4000-8000-000000000001/messages', {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns empty array when no messages', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(`/projects/${projectId}/messages`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns persisted messages oldest-first', async () => {
    const { app, projectId, state } = await seedProject()
    const projectMessages = [
      {
        message: { kind: 'message' as const, id: 'm1', role: 'user' as const, content: 'hi' },
        projectId,
        userId: USER_ID,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        message: {
          kind: 'message' as const,
          id: 'm2',
          role: 'assistant' as const,
          content: 'hello',
        },
        projectId,
        userId: null,
        createdAt: '2026-01-01T00:01:00.000Z',
      },
    ]
    state.agentMessages.push(...projectMessages)

    const res = await app.request(`/projects/${projectId}/messages`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const messages = (await res.json()) as AgentMessage[]
    expect(messages).toHaveLength(2)
    expect(messages[0]?.id).toBe('m1')
    expect(messages[1]?.id).toBe('m2')
  })

  it('respects the ?limit query parameter', async () => {
    const { app, projectId, state } = await seedProject()
    // Seed 5 messages
    for (let i = 0; i < 5; i++) {
      state.agentMessages.push({
        message: {
          kind: 'message' as const,
          id: `m${i}`,
          role: 'user' as const,
          content: `msg ${i}`,
        },
        projectId,
        userId: USER_ID,
        createdAt: `2026-01-01T00:0${i}:00.000Z`,
      })
    }
    const res = await app.request(`/projects/${projectId}/messages?limit=2`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const messages = (await res.json()) as AgentMessage[]
    expect(messages).toHaveLength(2)
  })
})
