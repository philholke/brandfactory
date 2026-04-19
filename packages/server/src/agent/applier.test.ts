import { describe, expect, it, vi } from 'vitest'
import type { AddCanvasBlockInput, CanvasOpApplier } from '@brandfactory/agent'
import type { RealtimeBus, RealtimeEvent } from '@brandfactory/adapter-realtime'
import type { CanvasBlock, CanvasId, ProjectId, ProseMirrorDoc, UserId } from '@brandfactory/shared'
import { createDbRealtimeApplier } from './applier'
import { createFakeDb, silentLogger } from '../test-helpers'

const PROJECT_ID = 'p-applier-1' as ProjectId
const CANVAS_ID = 'c-applier-1' as CanvasId
const USER_ID = 'u-applier-1' as UserId

const TEXT_DOC: ProseMirrorDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
}

function captureBus(): {
  bus: RealtimeBus
  published: Array<{ channel: string; event: RealtimeEvent }>
} {
  const published: Array<{ channel: string; event: RealtimeEvent }> = []
  const bus: RealtimeBus = {
    async publish(channel, event) {
      published.push({ channel, event })
    },
    subscribe: () => () => {},
  }
  return { bus, published }
}

async function withSeededBlock(
  applier: CanvasOpApplier,
  state: ReturnType<typeof createFakeDb>['state'],
  isPinned: boolean,
): Promise<CanvasBlock> {
  const input: AddCanvasBlockInput = {
    kind: 'text',
    body: TEXT_DOC,
    position: 0,
  }
  const block = await applier.addCanvasBlock(input)
  if (isPinned) {
    const seeded = state.canvasBlocks.get(block.id)!
    state.canvasBlocks.set(block.id, { ...seeded, isPinned: true })
  }
  return block
}

describe('createDbRealtimeApplier', () => {
  it('addCanvasBlock writes a text block, appends event, publishes canvas-op', async () => {
    const { db, state } = createFakeDb()
    const { bus, published } = captureBus()
    const applier = createDbRealtimeApplier({
      db,
      realtime: bus,
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      userId: USER_ID,
      log: silentLogger(),
    })

    const block = await applier.addCanvasBlock({ kind: 'text', body: TEXT_DOC, position: 3 })

    expect(block.kind).toBe('text')
    expect(block.createdBy).toBe('agent')
    expect(state.canvasBlocks.size).toBe(1)
    expect(state.canvasEvents).toHaveLength(1)
    const ev = state.canvasEvents[0]!
    expect(ev.op).toBe('add_block')
    expect(ev.actor).toBe('agent')
    expect(ev.userId).toBe(USER_ID)
    expect(ev.blockId).toBe(block.id)
    expect(published).toHaveLength(1)
    expect(published[0]!.channel).toBe(`project:${PROJECT_ID}`)
    expect(published[0]!.event).toEqual({
      kind: 'canvas-op',
      op: { op: 'add-block', block },
    })
  })

  it('pinBlock flips isPinned, appends pin event, publishes pin-op', async () => {
    const { db, state } = createFakeDb()
    const { bus, published } = captureBus()
    const applier = createDbRealtimeApplier({
      db,
      realtime: bus,
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      userId: USER_ID,
      log: silentLogger(),
    })
    const seeded = await withSeededBlock(applier, state, false)
    state.canvasEvents.length = 0
    published.length = 0

    const updated = await applier.pinBlock(seeded.id)

    expect(updated.isPinned).toBe(true)
    expect(state.canvasEvents).toHaveLength(1)
    expect(state.canvasEvents[0]!.op).toBe('pin')
    expect(published).toEqual([
      {
        channel: `project:${PROJECT_ID}`,
        event: { kind: 'pin-op', op: { op: 'pin', blockId: seeded.id } },
      },
    ])
  })

  it('unpinBlock mirrors pin with op=unpin', async () => {
    const { db, state } = createFakeDb()
    const { bus, published } = captureBus()
    const applier = createDbRealtimeApplier({
      db,
      realtime: bus,
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      userId: USER_ID,
      log: silentLogger(),
    })
    const seeded = await withSeededBlock(applier, state, true)
    state.canvasEvents.length = 0
    published.length = 0

    const updated = await applier.unpinBlock(seeded.id)

    expect(updated.isPinned).toBe(false)
    expect(state.canvasEvents).toHaveLength(1)
    expect(state.canvasEvents[0]!.op).toBe('unpin')
    expect(published[0]!.event).toEqual({
      kind: 'pin-op',
      op: { op: 'unpin', blockId: seeded.id },
    })
  })

  it('does not publish when the DB write throws (ordering invariant)', async () => {
    const { db } = createFakeDb()
    const failingDb = {
      ...db,
      createBlock: vi.fn(async () => {
        throw new Error('insert failed')
      }),
    }
    const { bus, published } = captureBus()
    const applier = createDbRealtimeApplier({
      db: failingDb,
      realtime: bus,
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      userId: USER_ID,
      log: silentLogger(),
    })

    await expect(
      applier.addCanvasBlock({ kind: 'text', body: TEXT_DOC, position: 0 }),
    ).rejects.toThrow(/insert failed/)
    expect(published).toHaveLength(0)
  })

  it('addCanvasBlock identifies the canvas via deps.canvasId', async () => {
    const { db, state } = createFakeDb()
    const { bus } = captureBus()
    const applier = createDbRealtimeApplier({
      db,
      realtime: bus,
      projectId: PROJECT_ID,
      canvasId: CANVAS_ID,
      userId: USER_ID,
      log: silentLogger(),
    })
    const block = await applier.addCanvasBlock({ kind: 'text', body: TEXT_DOC, position: 0 })
    expect(block.canvasId).toBe(CANVAS_ID)
    expect(state.canvasBlocks.get(block.id)!.canvasId).toBe(CANVAS_ID)
  })
})
