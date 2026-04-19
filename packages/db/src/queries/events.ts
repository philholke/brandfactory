import type { CanvasBlockId, CanvasId, JsonValue, UserId } from '@brandfactory/shared'
import { and, asc, desc, eq, gt } from 'drizzle-orm'
import { db } from '../client'
import { canvasEvents } from '../schema'

// Event rows aren't (yet) shaped by a shared schema — the wire-level event
// stream lives in `@brandfactory/shared` (`AgentEvent`), but the persisted
// log row is a DB concern. Expose the inferred row type for now.
export type CanvasEventRow = typeof canvasEvents.$inferSelect

export type AppendCanvasEventInput = {
  canvasId: CanvasId
  blockId?: CanvasBlockId | null
  op: CanvasEventRow['op']
  actor: CanvasEventRow['actor']
  userId?: UserId | null
  payload: JsonValue
}

export async function appendCanvasEvent(input: AppendCanvasEventInput): Promise<CanvasEventRow> {
  const [row] = await db
    .insert(canvasEvents)
    .values({
      canvasId: input.canvasId,
      blockId: input.blockId ?? null,
      op: input.op,
      actor: input.actor,
      userId: input.userId ?? null,
      payload: input.payload,
    })
    .returning()
  if (!row) throw new Error('appendCanvasEvent returned no row')
  return row
}

export async function listCanvasEvents(
  canvasId: CanvasId,
  opts: { since?: string; limit?: number } = {},
): Promise<CanvasEventRow[]> {
  const conditions = [eq(canvasEvents.canvasId, canvasId)]
  if (opts.since) conditions.push(gt(canvasEvents.createdAt, opts.since))

  const base = db
    .select()
    .from(canvasEvents)
    .where(and(...conditions))
    .orderBy(desc(canvasEvents.createdAt))

  return opts.limit !== undefined ? base.limit(opts.limit) : base
}

export async function listBlockEvents(blockId: CanvasBlockId): Promise<CanvasEventRow[]> {
  return db
    .select()
    .from(canvasEvents)
    .where(eq(canvasEvents.blockId, blockId))
    .orderBy(asc(canvasEvents.createdAt))
}
