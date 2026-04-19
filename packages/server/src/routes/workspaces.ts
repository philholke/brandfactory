import { CreateWorkspaceInputSchema, WorkspaceIdSchema, type UserId } from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireWorkspaceAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import { UnauthorizedError } from '../errors'

export interface WorkspacesDeps {
  db: Db
}

const IdParam = z.object({ id: WorkspaceIdSchema })

export function createWorkspacesRouter(deps: WorkspacesDeps) {
  return new Hono<AppEnv>()
    .get('/', async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const rows = await deps.db.listWorkspacesByOwner(userId as UserId)
      return c.json(rows)
    })
    .post('/', zValidator('json', CreateWorkspaceInputSchema), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const body = c.req.valid('json')
      const row = await deps.db.createWorkspace({ name: body.name, ownerUserId: userId as UserId })
      return c.json(row, 201)
    })
    .get('/:id', zValidator('param', IdParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { id } = c.req.valid('param')
      const workspace = await requireWorkspaceAccess(userId, id, deps.db)
      return c.json(workspace)
    })
}
