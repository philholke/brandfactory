import type {
  Canvas,
  CanvasBlock,
  CanvasBlockCreatedBy,
  CanvasBlockId,
  CanvasId,
  ProjectId,
  ProseMirrorDoc,
  ShortlistView,
} from '@brandfactory/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../client'
import { rowToCanvas, rowToCanvasBlock } from '../mappers'
import { canvasBlocks, canvases } from '../schema'

export async function getCanvasByProject(projectId: ProjectId): Promise<Canvas | null> {
  const [row] = await db.select().from(canvases).where(eq(canvases.projectId, projectId))
  return row ? rowToCanvas(row) : null
}

export async function listActiveBlocks(canvasId: CanvasId): Promise<CanvasBlock[]> {
  const rows = await db
    .select()
    .from(canvasBlocks)
    .where(and(eq(canvasBlocks.canvasId, canvasId), isNull(canvasBlocks.deletedAt)))
    .orderBy(asc(canvasBlocks.position))
  return rows.map(rowToCanvasBlock)
}

// Insert input mirrors the shared discriminated union minus server-generated
// fields: `id`, `createdAt`, `updatedAt`, and the pin / soft-delete flags
// (which default at the DB level). Keeping the union distributive so the
// kind-specific required fields survive the `Omit`.
export type CreateBlockInput = (
  | { kind: 'text'; body: ProseMirrorDoc }
  | { kind: 'image'; blobKey: string; alt?: string; width?: number; height?: number }
  | { kind: 'file'; blobKey: string; filename: string; mime: string }
) & {
  canvasId: CanvasId
  position: number
  createdBy: CanvasBlockCreatedBy
}

export async function createBlock(input: CreateBlockInput): Promise<CanvasBlock> {
  const shared = {
    canvasId: input.canvasId,
    kind: input.kind,
    position: input.position,
    createdBy: input.createdBy,
  } as const

  let values: typeof canvasBlocks.$inferInsert
  switch (input.kind) {
    case 'text':
      values = { ...shared, body: input.body }
      break
    case 'image':
      values = {
        ...shared,
        blobKey: input.blobKey,
        alt: input.alt ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
      }
      break
    case 'file':
      values = {
        ...shared,
        blobKey: input.blobKey,
        filename: input.filename,
        mime: input.mime,
      }
      break
  }

  const [row] = await db.insert(canvasBlocks).values(values).returning()
  if (!row) throw new Error('createBlock returned no row')
  return rowToCanvasBlock(row)
}

// Partial patch — callers assemble whatever kind-specific subset they need.
// Kind itself is immutable; swap by creating a new block.
export type UpdateBlockPatch = Partial<{
  position: number
  body: ProseMirrorDoc
  blobKey: string
  alt: string | null
  width: number | null
  height: number | null
  filename: string
  mime: string
}>

export async function updateBlock(
  id: CanvasBlockId,
  patch: UpdateBlockPatch,
): Promise<CanvasBlock> {
  const [row] = await db
    .update(canvasBlocks)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(canvasBlocks.id, id))
    .returning()
  if (!row) throw new Error(`Block ${id} not found`)
  return rowToCanvasBlock(row)
}

export async function softDeleteBlock(id: CanvasBlockId): Promise<CanvasBlock> {
  const [row] = await db
    .update(canvasBlocks)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(canvasBlocks.id, id))
    .returning()
  if (!row) throw new Error(`Block ${id} not found`)
  return rowToCanvasBlock(row)
}

export async function restoreBlock(id: CanvasBlockId): Promise<CanvasBlock> {
  const [row] = await db
    .update(canvasBlocks)
    .set({ deletedAt: null, updatedAt: sql`now()` })
    .where(eq(canvasBlocks.id, id))
    .returning()
  if (!row) throw new Error(`Block ${id} not found`)
  return rowToCanvasBlock(row)
}

export async function setPinned(id: CanvasBlockId, value: boolean): Promise<CanvasBlock> {
  const [row] = await db
    .update(canvasBlocks)
    .set({
      isPinned: value,
      pinnedAt: value ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(eq(canvasBlocks.id, id))
    .returning()
  if (!row) throw new Error(`Block ${id} not found`)
  return rowToCanvasBlock(row)
}

export async function getShortlistView(projectId: ProjectId): Promise<ShortlistView> {
  const rows = await db
    .select({ blockId: canvasBlocks.id })
    .from(canvasBlocks)
    .innerJoin(canvases, eq(canvasBlocks.canvasId, canvases.id))
    .where(
      and(
        eq(canvases.projectId, projectId),
        eq(canvasBlocks.isPinned, true),
        isNull(canvasBlocks.deletedAt),
      ),
    )
    .orderBy(asc(canvasBlocks.position))
  return {
    projectId,
    blockIds: rows.map((r) => r.blockId as CanvasBlockId),
  }
}
