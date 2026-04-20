import type { RealtimeBus } from '@brandfactory/adapter-realtime'
import {
  CanvasBlockIdSchema,
  CreateCanvasBlockInputSchema,
  ProjectIdSchema,
  UpdateCanvasBlockInputSchema,
  type CanvasBlock,
  type CanvasBlockId,
  type CanvasId,
  type CanvasOp,
  type JsonValue,
  type PinOp,
  type ProjectId,
  type UserId,
} from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireProjectAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import { NotFoundError, UnauthorizedError } from '../errors'

export interface CanvasDeps {
  db: Db
  realtime: RealtimeBus
}

const ProjectParam = z.object({ id: ProjectIdSchema })
const BlockParam = z.object({ id: ProjectIdSchema, blockId: CanvasBlockIdSchema })

interface OpContext {
  projectId: ProjectId
  canvasId: CanvasId
  userId: UserId
}

// Three-step invariant: DB write (caller) → event log append → realtime
// publish. Ordering matters: a publish failure leaves a persisted mutation
// that clients observe on the next GET — strictly better than a phantom event
// for state that never landed.
async function emitCanvasOp(
  deps: CanvasDeps,
  ctx: OpContext,
  block: CanvasBlock,
  dbOp: 'add_block' | 'update_block' | 'remove_block',
  wireOp: CanvasOp,
): Promise<void> {
  await deps.db.appendCanvasEvent({
    canvasId: ctx.canvasId,
    blockId: block.id,
    op: dbOp,
    actor: 'user',
    userId: ctx.userId,
    payload: wireOp as unknown as JsonValue,
  })
  await deps.realtime.publish(`project:${ctx.projectId}`, { kind: 'canvas-op', op: wireOp })
}

async function emitPinOp(
  deps: CanvasDeps,
  ctx: OpContext,
  block: CanvasBlock,
  dbOp: 'pin' | 'unpin',
  wireOp: PinOp,
): Promise<void> {
  await deps.db.appendCanvasEvent({
    canvasId: ctx.canvasId,
    blockId: block.id,
    op: dbOp,
    actor: 'user',
    userId: ctx.userId,
    payload: wireOp as unknown as JsonValue,
  })
  await deps.realtime.publish(`project:${ctx.projectId}`, { kind: 'pin-op', op: wireOp })
}

// Verify the block belongs to the canvas and is not soft-deleted. Throws 404
// if not — prevents mutations leaking across project boundaries.
async function requireBlock(
  db: Db,
  blockId: CanvasBlockId,
  canvasId: CanvasId,
): Promise<CanvasBlock> {
  const block = await db.getBlockById(blockId)
  if (!block || block.canvasId !== canvasId || block.deletedAt !== null) {
    throw new NotFoundError('block not found', 'BLOCK_NOT_FOUND')
  }
  return block
}

export function createCanvasRouter(deps: CanvasDeps) {
  return new Hono<AppEnv>()
    .get('/:id/canvas/blocks', zValidator('param', ProjectParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { id } = c.req.valid('param')
      const { project } = await requireProjectAccess(userId, id, deps.db)
      const canvas = await deps.db.getCanvasByProject(project.id)
      if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
      return c.json(await deps.db.listActiveBlocks(canvas.id))
    })
    .get('/:id/shortlist', zValidator('param', ProjectParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { id } = c.req.valid('param')
      const { project } = await requireProjectAccess(userId, id, deps.db)
      return c.json(await deps.db.getShortlistView(project.id))
    })
    .post(
      '/:id/canvas/blocks',
      zValidator('param', ProjectParam),
      zValidator('json', CreateCanvasBlockInputSchema),
      async (c) => {
        const rawUserId = c.var.userId
        if (!rawUserId) throw new UnauthorizedError()
        const userId = rawUserId as UserId
        const { id } = c.req.valid('param')
        const body = c.req.valid('json')
        const { project } = await requireProjectAccess(rawUserId, id, deps.db)
        const canvas = await deps.db.getCanvasByProject(project.id)
        if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')

        // If position is omitted, append after the last active block.
        let position = body.position
        if (position === undefined) {
          const existing = await deps.db.listActiveBlocks(canvas.id)
          position = existing.reduce((m, b) => Math.max(m, b.position), 0) + 1000
        }

        let block: CanvasBlock
        switch (body.kind) {
          case 'text':
            block = await deps.db.createBlock({
              canvasId: canvas.id,
              kind: 'text',
              body: body.body,
              position,
              createdBy: 'user',
            })
            break
          case 'image':
            block = await deps.db.createBlock({
              canvasId: canvas.id,
              kind: 'image',
              blobKey: body.blobKey,
              alt: body.alt,
              width: body.width,
              height: body.height,
              position,
              createdBy: 'user',
            })
            break
          case 'file':
            block = await deps.db.createBlock({
              canvasId: canvas.id,
              kind: 'file',
              blobKey: body.blobKey,
              filename: body.filename,
              mime: body.mime,
              position,
              createdBy: 'user',
            })
            break
        }

        const ctx: OpContext = { projectId: project.id, canvasId: canvas.id, userId }
        await emitCanvasOp(deps, ctx, block, 'add_block', { op: 'add-block', block })
        return c.json(block, 201)
      },
    )
    .patch(
      '/:id/canvas/blocks/:blockId',
      zValidator('param', BlockParam),
      zValidator('json', UpdateCanvasBlockInputSchema),
      async (c) => {
        const rawUserId = c.var.userId
        if (!rawUserId) throw new UnauthorizedError()
        const userId = rawUserId as UserId
        const { id, blockId } = c.req.valid('param')
        const patch = c.req.valid('json')
        const { project } = await requireProjectAccess(rawUserId, id, deps.db)
        const canvas = await deps.db.getCanvasByProject(project.id)
        if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
        await requireBlock(deps.db, blockId, canvas.id)
        const block = await deps.db.updateBlock(blockId, patch)
        const ctx: OpContext = { projectId: project.id, canvasId: canvas.id, userId }
        await emitCanvasOp(deps, ctx, block, 'update_block', {
          op: 'update-block',
          blockId: block.id,
          patch: patch as unknown as JsonValue,
        })
        return c.json(block)
      },
    )
    .post('/:id/canvas/blocks/:blockId/pin', zValidator('param', BlockParam), async (c) => {
      const rawUserId = c.var.userId
      if (!rawUserId) throw new UnauthorizedError()
      const userId = rawUserId as UserId
      const { id, blockId } = c.req.valid('param')
      const { project } = await requireProjectAccess(rawUserId, id, deps.db)
      const canvas = await deps.db.getCanvasByProject(project.id)
      if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
      await requireBlock(deps.db, blockId, canvas.id)
      const block = await deps.db.setPinned(blockId, true)
      const ctx: OpContext = { projectId: project.id, canvasId: canvas.id, userId }
      await emitPinOp(deps, ctx, block, 'pin', { op: 'pin', blockId: block.id })
      return c.json(block)
    })
    .post('/:id/canvas/blocks/:blockId/unpin', zValidator('param', BlockParam), async (c) => {
      const rawUserId = c.var.userId
      if (!rawUserId) throw new UnauthorizedError()
      const userId = rawUserId as UserId
      const { id, blockId } = c.req.valid('param')
      const { project } = await requireProjectAccess(rawUserId, id, deps.db)
      const canvas = await deps.db.getCanvasByProject(project.id)
      if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
      await requireBlock(deps.db, blockId, canvas.id)
      const block = await deps.db.setPinned(blockId, false)
      const ctx: OpContext = { projectId: project.id, canvasId: canvas.id, userId }
      await emitPinOp(deps, ctx, block, 'unpin', { op: 'unpin', blockId: block.id })
      return c.json(block)
    })
    .delete('/:id/canvas/blocks/:blockId', zValidator('param', BlockParam), async (c) => {
      const rawUserId = c.var.userId
      if (!rawUserId) throw new UnauthorizedError()
      const userId = rawUserId as UserId
      const { id, blockId } = c.req.valid('param')
      const { project } = await requireProjectAccess(rawUserId, id, deps.db)
      const canvas = await deps.db.getCanvasByProject(project.id)
      if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
      await requireBlock(deps.db, blockId, canvas.id)
      const block = await deps.db.softDeleteBlock(blockId)
      const ctx: OpContext = { projectId: project.id, canvasId: canvas.id, userId }
      await emitCanvasOp(deps, ctx, block, 'remove_block', {
        op: 'remove-block',
        blockId: block.id,
      })
      return new Response(null, { status: 204 })
    })
}
