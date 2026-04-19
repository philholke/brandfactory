import type { BrandGuidelineSection, UserId } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

async function seedBrand(tokenUser: { id: string; token: string }) {
  const { app, state } = createTestApp({ users: [tokenUser] })
  const wsRes = await app.request('/workspaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenUser.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'W' }),
  })
  const ws = (await wsRes.json()) as { id: string }
  const brRes = await app.request(`/workspaces/${ws.id}/brands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenUser.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'B' }),
  })
  const br = (await brRes.json()) as { id: string }
  return { app, state, workspaceId: ws.id, brandId: br.id }
}

describe('brands routes', () => {
  it('POST /workspaces/:id/brands creates a brand in an owned workspace', async () => {
    const { brandId } = await seedBrand({ id: 'u-1', token: 't-1' })
    expect(brandId).toMatch(/^br-/)
  })

  it('POST /workspaces/:id/brands forbids a non-owner', async () => {
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
    const res = await app.request('/workspaces/w-theirs/brands', {
      method: 'POST',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(403)
  })

  it('GET /brands/:id hydrates sections', async () => {
    const { app, brandId } = await seedBrand({ id: 'u-1', token: 't-1' })
    const res = await app.request(`/brands/${brandId}`, {
      headers: { authorization: 'Bearer t-1' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; sections: BrandGuidelineSection[] }
    expect(body.id).toBe(brandId)
    expect(Array.isArray(body.sections)).toBe(true)
  })

  it('PATCH /brands/:id/guidelines upserts + reorders sections', async () => {
    const { app, brandId } = await seedBrand({ id: 'u-1', token: 't-1' })
    const patch1 = await app.request(`/brands/${brandId}/guidelines`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        sections: [
          { label: 'Voice', body: { type: 'doc', content: [] }, priority: 1 },
          { label: 'Audience', body: { type: 'doc', content: [] }, priority: 2 },
        ],
      }),
    })
    expect(patch1.status).toBe(200)
    const first = (await patch1.json()) as BrandGuidelineSection[]
    expect(first.map((s) => s.label)).toEqual(['Voice', 'Audience'])

    // Reorder: reuse ids, swap priorities; update the first's label.
    const [voice, audience] = first
    const patch2 = await app.request(`/brands/${brandId}/guidelines`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer t-1', 'content-type': 'application/json' },
      body: JSON.stringify({
        sections: [
          { id: audience!.id, label: 'Audience', body: { type: 'doc', content: [] }, priority: 1 },
          {
            id: voice!.id,
            label: 'Voice & tone',
            body: { type: 'doc', content: [] },
            priority: 2,
          },
        ],
      }),
    })
    expect(patch2.status).toBe(200)
    const second = (await patch2.json()) as BrandGuidelineSection[]
    expect(second.map((s) => s.label)).toEqual(['Audience', 'Voice & tone'])
  })
})
