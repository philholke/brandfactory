import type { ResolvedWorkspaceSettings } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

async function seedWorkspace(token: string, userId: string) {
  const { app, state } = createTestApp({ users: [{ id: userId, token }] })
  const ws = (await (
    await app.request('/workspaces', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'W' }),
    })
  ).json()) as { id: string }
  return { app, state, workspaceId: ws.id }
}

describe('settings routes', () => {
  it('GET /workspaces/:id/settings falls back to env defaults', async () => {
    const { app, workspaceId } = await seedWorkspace('t-1', 'u-1')
    const res = await app.request(`/workspaces/${workspaceId}/settings`, {
      headers: { authorization: 'Bearer t-1' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ResolvedWorkspaceSettings
    expect(body.source).toBe('env')
    expect(body.llmProviderId).toBe('anthropic')
    expect(body.llmModel).toBe('claude-sonnet-4-6')
  })

  it('PATCH then GET returns source=workspace with the new values', async () => {
    const { app, workspaceId } = await seedWorkspace('t-1', 'u-1')
    const patch = await app.request(`/workspaces/${workspaceId}/settings`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({ llmProviderId: 'openai', llmModel: 'gpt-4o-mini' }),
    })
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as ResolvedWorkspaceSettings
    expect(patched).toMatchObject({
      source: 'workspace',
      llmProviderId: 'openai',
      llmModel: 'gpt-4o-mini',
    })

    const get = await app.request(`/workspaces/${workspaceId}/settings`, {
      headers: { authorization: 'Bearer t-1' },
    })
    const got = (await get.json()) as ResolvedWorkspaceSettings
    expect(got).toMatchObject({
      source: 'workspace',
      llmProviderId: 'openai',
      llmModel: 'gpt-4o-mini',
    })
  })

  it('PATCH rejects an unknown provider with 400', async () => {
    const { app, workspaceId } = await seedWorkspace('t-1', 'u-1')
    const res = await app.request(`/workspaces/${workspaceId}/settings`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({ llmProviderId: 'bogus', llmModel: 'x' }),
    })
    expect(res.status).toBe(400)
  })
})
