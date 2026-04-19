import type { AddCanvasBlockInput, CanvasOpApplier } from '@brandfactory/agent'
import type { RealtimeBus } from '@brandfactory/adapter-realtime'
import type { CanvasBlock, CanvasBlockId, CanvasId, ProjectId, UserId } from '@brandfactory/shared'
import type { Db } from '../db'
import type { Logger } from '../logger'

export interface DbRealtimeApplierDeps {
  db: Pick<Db, 'createBlock' | 'setPinned' | 'appendCanvasEvent'>
  realtime: RealtimeBus
  projectId: ProjectId
  canvasId: CanvasId
  userId: UserId
  log: Logger
}

// Wires the agent's `CanvasOpApplier` side-effect seam to real persistence
// + realtime fan-out. Ordering is DB write → event append → realtime publish
// on purpose: a publish failure leaves a persisted mutation that a client
// will observe on its next GET, while the reverse would emit phantom events
// for state that never landed. The three steps are deliberately not wrapped
// in a transaction — the event log is append-only and replay-safe, so a
// missing event for an existing block is no worse than an un-logged user
// write.
export function createDbRealtimeApplier(deps: DbRealtimeApplierDeps): CanvasOpApplier {
  const channel = `project:${deps.projectId}`

  return {
    async addCanvasBlock(input: AddCanvasBlockInput): Promise<CanvasBlock> {
      const block = await deps.db.createBlock({
        canvasId: deps.canvasId,
        kind: 'text',
        body: input.body,
        position: input.position,
        createdBy: 'agent',
      })
      await deps.db.appendCanvasEvent({
        canvasId: deps.canvasId,
        blockId: block.id,
        op: 'add_block',
        actor: 'agent',
        userId: deps.userId,
        payload: { op: 'add-block', block },
      })
      await deps.realtime.publish(channel, { kind: 'canvas-op', op: { op: 'add-block', block } })
      return block
    },

    async pinBlock(blockId: CanvasBlockId): Promise<CanvasBlock> {
      const block = await deps.db.setPinned(blockId, true)
      await deps.db.appendCanvasEvent({
        canvasId: deps.canvasId,
        blockId: block.id,
        op: 'pin',
        actor: 'agent',
        userId: deps.userId,
        payload: { op: 'pin', blockId: block.id },
      })
      await deps.realtime.publish(channel, { kind: 'pin-op', op: { op: 'pin', blockId: block.id } })
      return block
    },

    async unpinBlock(blockId: CanvasBlockId): Promise<CanvasBlock> {
      const block = await deps.db.setPinned(blockId, false)
      await deps.db.appendCanvasEvent({
        canvasId: deps.canvasId,
        blockId: block.id,
        op: 'unpin',
        actor: 'agent',
        userId: deps.userId,
        payload: { op: 'unpin', blockId: block.id },
      })
      await deps.realtime.publish(channel, {
        kind: 'pin-op',
        op: { op: 'unpin', blockId: block.id },
      })
      return block
    },
  }
}
