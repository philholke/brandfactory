import type { Canvas } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

async function seedBrand(token: string, userId: string) {
  const { app, state } = createTestApp({ users: [{ id: userId, token }] })
  const ws = (await (
    await app.request('/workspaces', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'W' }),
    })
  ).json()) as { id: string }
  const br = (await (
    await app.request(`/workspaces/${ws.id}/brands`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    })
  ).json()) as { id: string }
  return { app, state, brandId: br.id }
}

describe('projects routes', () => {
  it('POST /brands/:brandId/projects creates a freeform project + canvas', async () => {
    const { app, state, brandId } = await seedBrand('t-1', 'u-1')
    const res = await app.request(`/brands/${brandId}/projects`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'freeform', name: 'Naming' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; kind: string }
    expect(body.kind).toBe('freeform')
    expect([...state.canvases.values()].some((c) => c.projectId === body.id)).toBe(true)
  })

  it('POST /brands/:brandId/projects creates a standardized project with templateId', async () => {
    const { app, brandId } = await seedBrand('t-1', 'u-1')
    const res = await app.request(`/brands/${brandId}/projects`, {
      method: 'POST',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'standardized',
        name: 'Calendar',
        templateId: 'social-calendar',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { kind: string; templateId: string }
    expect(body).toMatchObject({ kind: 'standardized', templateId: 'social-calendar' })
  })

  it('GET /projects/:id returns the project with canvas nested', async () => {
    const { app, brandId } = await seedBrand('t-1', 'u-1')
    const created = (await (
      await app.request(`/brands/${brandId}/projects`, {
        method: 'POST',
        headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'freeform', name: 'Naming' }),
      })
    ).json()) as { id: string }
    const res = await app.request(`/projects/${created.id}`, {
      headers: { authorization: 'Bearer t-1' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; canvas: Canvas | null }
    expect(body.id).toBe(created.id)
    expect(body.canvas?.projectId).toBe(created.id)
  })
})
