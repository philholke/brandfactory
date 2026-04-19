import {
  BrandIdSchema,
  CreateBrandInputSchema,
  UpdateBrandGuidelinesInputSchema,
  WorkspaceIdSchema,
  type BrandWithSections,
} from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireBrandAccess, requireWorkspaceAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import { UnauthorizedError } from '../errors'

export interface BrandsDeps {
  db: Db
}

// Two mounted shapes — workspace-scoped list/create and brand-scoped
// read/patch — live in the same module so the guideline-upsert stays near
// its siblings. `app.ts` mounts each router under its own prefix.
export function createWorkspaceBrandsRouter(deps: BrandsDeps) {
  const WorkspaceParam = z.object({ workspaceId: WorkspaceIdSchema })

  return new Hono<AppEnv>()
    .get('/:workspaceId/brands', zValidator('param', WorkspaceParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { workspaceId } = c.req.valid('param')
      await requireWorkspaceAccess(userId, workspaceId, deps.db)
      const rows = await deps.db.listBrandsByWorkspace(workspaceId)
      return c.json(rows)
    })
    .post(
      '/:workspaceId/brands',
      zValidator('param', WorkspaceParam),
      zValidator('json', CreateBrandInputSchema),
      async (c) => {
        const userId = c.var.userId
        if (!userId) throw new UnauthorizedError()
        const { workspaceId } = c.req.valid('param')
        await requireWorkspaceAccess(userId, workspaceId, deps.db)
        const body = c.req.valid('json')
        const row = await deps.db.createBrand({
          workspaceId,
          name: body.name,
          description: body.description ?? null,
        })
        return c.json(row, 201)
      },
    )
}

export function createBrandsRouter(deps: BrandsDeps) {
  const BrandParam = z.object({ id: BrandIdSchema })

  return new Hono<AppEnv>()
    .get('/:id', zValidator('param', BrandParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { id } = c.req.valid('param')
      const { brand } = await requireBrandAccess(userId, id, deps.db)
      const sections = await deps.db.listSectionsByBrand(id)
      const body: BrandWithSections = { ...brand, sections }
      return c.json(body)
    })
    .patch(
      '/:id/guidelines',
      zValidator('param', BrandParam),
      zValidator('json', UpdateBrandGuidelinesInputSchema),
      async (c) => {
        const userId = c.var.userId
        if (!userId) throw new UnauthorizedError()
        const { id } = c.req.valid('param')
        await requireBrandAccess(userId, id, deps.db)
        const body = c.req.valid('json')
        // Single-tx upsert + reorder lives in `@brandfactory/db` so a
        // mid-list failure rolls back instead of leaving the brand half
        // updated.
        const sections = await deps.db.updateBrandGuidelines(
          id,
          body.sections.map((s) => ({
            id: s.id,
            label: s.label,
            body: s.body,
            priority: s.priority,
            createdBy: 'user',
          })),
        )
        return c.json(sections)
      },
    )
}
