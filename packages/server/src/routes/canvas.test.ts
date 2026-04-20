import type { RealtimeBus, RealtimeEvent } from '@brandfactory/adapter-realtime'
import type { CanvasBlock } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { createTestApp, type TestHarness } from '../test-helpers'

const TOKEN = 't-canvas'
const USER_ID = 'u-canvas'

interface SeededHarness extends TestHarness {
  projectId: string
  canvasId: string
}

function captureBus(): {
  bus: RealtimeBus
  published: Array<{ channel: string; event: RealtimeEvent }>
} {
  const published: Array<{ channel: string; event: RealtimeEvent }> = []
  return {
    published,
    bus: {
      async publish(channel, event) {
        published.push({ channel, event })
      },
      subscribe: () => () => {},
    },
  }
}

async function seedProject(realtime?: RealtimeBus): Promise<SeededHarness> {
  const harness = createTestApp({
    users: [{ id: USER_ID, token: TOKEN }],
    ...(realtime ? { realtime } : {}),
  })
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
  const canvas = [...harness.state.canvases.values()].find((c) => c.projectId === pr.id)!
  return { ...harness, projectId: pr.id, canvasId: canvas.id }
}

const AUTH = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

// ---------------------------------------------------------------------------
// GET /projects/:id/canvas/blocks
// ---------------------------------------------------------------------------

describe('GET /projects/:id/canvas/blocks', () => {
  it('returns 401 without auth', async () => {
    const { app } = await seedProject()
    const res = await app.request('/projects/00000000-0000-4000-8000-000000000001/canvas/blocks')
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown project', async () => {
    const { app } = await seedProject()
    const res = await app.request('/projects/00000000-0000-4000-8000-000000000001/canvas/blocks', {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns empty array when canvas has no blocks', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(`/projects/${projectId}/canvas/blocks`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GET /projects/:id/shortlist
// ---------------------------------------------------------------------------

describe('GET /projects/:id/shortlist', () => {
  it('returns 401 without auth', async () => {
    const { app } = await seedProject()
    const res = await app.request('/projects/00000000-0000-4000-8000-000000000001/shortlist')
    expect(res.status).toBe(401)
  })

  it('returns empty shortlist for a fresh project', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(`/projects/${projectId}/shortlist`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { blockIds: string[] }
    expect(body.blockIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// POST /projects/:id/canvas/blocks
// ---------------------------------------------------------------------------

describe('POST /projects/:id/canvas/blocks', () => {
  it('returns 401 without auth', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(`/projects/${projectId}/canvas/blocks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
    })
    expect(res.status).toBe(401)
  })

  it('creates a text block and publishes a canvas-op', async () => {
    const { bus, published } = captureBus()
    const { app, projectId, canvasId, state } = await seedProject(bus)
    const res = await app.request(`/projects/${projectId}/canvas/blocks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
    })
    expect(res.status).toBe(201)
    const block = (await res.json()) as CanvasBlock
    expect(block.kind).toBe('text')
    expect(block.createdBy).toBe('user')
    // Block persisted in fake state
    expect(state.canvasBlocks.has(block.id)).toBe(true)
    // Canvas event appended
    expect(state.canvasEvents.some((e) => e.op === 'add_block' && e.canvasId === canvasId)).toBe(
      true,
    )
    // Realtime published
    const pub = published.find((p) => p.channel === `project:${projectId}`)
    expect(pub?.event).toMatchObject({ kind: 'canvas-op', op: { op: 'add-block' } })
  })

  it('auto-computes position after existing blocks', async () => {
    const { app, projectId } = await seedProject()
    // Seed an existing block with position 5000
    await app.request(`/projects/${projectId}/canvas/blocks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] }, position: 5000 }),
    })
    // Create another without position — should be 6000
    const res = await app.request(`/projects/${projectId}/canvas/blocks`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
    })
    const block = (await res.json()) as CanvasBlock
    expect(block.position).toBe(6000)
  })
})

// ---------------------------------------------------------------------------
// PATCH /projects/:id/canvas/blocks/:blockId
// ---------------------------------------------------------------------------

describe('PATCH /projects/:id/canvas/blocks/:blockId', () => {
  it('returns 401 without auth', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(
      `/projects/${projectId}/canvas/blocks/00000000-0000-4000-8000-000000000001`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ position: 2 }),
      },
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 for a block not in this project', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(
      `/projects/${projectId}/canvas/blocks/00000000-0000-4000-8000-000000000001`,
      { method: 'PATCH', headers: AUTH, body: JSON.stringify({ position: 2 }) },
    )
    expect(res.status).toBe(404)
  })

  it('updates block and publishes update-block event', async () => {
    const { bus, published } = captureBus()
    const { app, projectId } = await seedProject(bus)
    // Create a block first
    const created = (await (
      await app.request(`/projects/${projectId}/canvas/blocks`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] }, position: 100 }),
      })
    ).json()) as CanvasBlock

    published.length = 0 // clear create event

    const res = await app.request(`/projects/${projectId}/canvas/blocks/${created.id}`, {
      method: 'PATCH',
      headers: AUTH,
      body: JSON.stringify({ position: 200 }),
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()) as CanvasBlock
    expect(updated.position).toBe(200)
    const pub = published.find((p) => p.channel === `project:${projectId}`)
    expect(pub?.event).toMatchObject({ kind: 'canvas-op', op: { op: 'update-block' } })
  })
})

// ---------------------------------------------------------------------------
// POST /projects/:id/canvas/blocks/:blockId/pin
// ---------------------------------------------------------------------------

describe('POST .../pin and .../unpin', () => {
  it('pins a block and publishes pin-op', async () => {
    const { bus, published } = captureBus()
    const { app, projectId } = await seedProject(bus)
    const created = (await (
      await app.request(`/projects/${projectId}/canvas/blocks`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
      })
    ).json()) as CanvasBlock

    published.length = 0

    const res = await app.request(`/projects/${projectId}/canvas/blocks/${created.id}/pin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const block = (await res.json()) as CanvasBlock
    expect(block.isPinned).toBe(true)
    expect(published[0]?.event).toMatchObject({ kind: 'pin-op', op: { op: 'pin' } })
  })

  it('unpins a block and publishes unpin-op', async () => {
    const { bus, published } = captureBus()
    const { app, projectId } = await seedProject(bus)
    const created = (await (
      await app.request(`/projects/${projectId}/canvas/blocks`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
      })
    ).json()) as CanvasBlock

    await app.request(`/projects/${projectId}/canvas/blocks/${created.id}/pin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    published.length = 0

    const res = await app.request(`/projects/${projectId}/canvas/blocks/${created.id}/unpin`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const block = (await res.json()) as CanvasBlock
    expect(block.isPinned).toBe(false)
    expect(published[0]?.event).toMatchObject({ kind: 'pin-op', op: { op: 'unpin' } })
  })
})

// ---------------------------------------------------------------------------
// DELETE /projects/:id/canvas/blocks/:blockId
// ---------------------------------------------------------------------------

describe('DELETE /projects/:id/canvas/blocks/:blockId', () => {
  it('returns 401 without auth', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(
      `/projects/${projectId}/canvas/blocks/00000000-0000-4000-8000-000000000001`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(401)
  })

  it('soft-deletes a block and publishes remove-block event', async () => {
    const { bus, published } = captureBus()
    const { app, projectId, state } = await seedProject(bus)
    const created = (await (
      await app.request(`/projects/${projectId}/canvas/blocks`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
      })
    ).json()) as CanvasBlock

    published.length = 0

    const res = await app.request(`/projects/${projectId}/canvas/blocks/${created.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(204)
    // Block is soft-deleted (still in map but with deletedAt set)
    const stored = state.canvasBlocks.get(created.id)
    expect(stored?.deletedAt).not.toBeNull()
    // No longer in active blocks
    const listRes = await app.request(`/projects/${projectId}/canvas/blocks`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    const blocks = (await listRes.json()) as CanvasBlock[]
    expect(blocks.find((b) => b.id === created.id)).toBeUndefined()
    // Realtime published
    expect(published[0]?.event).toMatchObject({ kind: 'canvas-op', op: { op: 'remove-block' } })
  })

  it('returns 404 when trying to delete an already-deleted block', async () => {
    const { app, projectId } = await seedProject()
    const created = (await (
      await app.request(`/projects/${projectId}/canvas/blocks`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ kind: 'text', body: { type: 'doc', content: [] } }),
      })
    ).json()) as CanvasBlock

    await app.request(`/projects/${projectId}/canvas/blocks/${created.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    const res = await app.request(`/projects/${projectId}/canvas/blocks/${created.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })
})
