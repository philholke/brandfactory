import {
  BrandIdSchema,
  CreateProjectInputSchema,
  ProjectIdSchema,
  type BrandWithSections,
} from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireBrandAccess, requireProjectAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import { NotFoundError, UnauthorizedError } from '../errors'

export interface ProjectsDeps {
  db: Db
}

export function createBrandProjectsRouter(deps: ProjectsDeps) {
  const BrandParam = z.object({ brandId: BrandIdSchema })

  return new Hono<AppEnv>()
    .get('/:brandId/projects', zValidator('param', BrandParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { brandId } = c.req.valid('param')
      await requireBrandAccess(userId, brandId, deps.db)
      const rows = await deps.db.listProjectsByBrand(brandId)
      return c.json(rows)
    })
    .post(
      '/:brandId/projects',
      zValidator('param', BrandParam),
      zValidator('json', CreateProjectInputSchema),
      async (c) => {
        const userId = c.var.userId
        if (!userId) throw new UnauthorizedError()
        const { brandId } = c.req.valid('param')
        await requireBrandAccess(userId, brandId, deps.db)
        const body = c.req.valid('json')
        // 1:1 project↔canvas invariant lives in a single tx in
        // `@brandfactory/db` so a mid-write failure never leaves an orphan.
        const { project } =
          body.kind === 'freeform'
            ? await deps.db.createProjectWithCanvas({
                kind: 'freeform',
                brandId,
                name: body.name,
              })
            : await deps.db.createProjectWithCanvas({
                kind: 'standardized',
                brandId,
                name: body.name,
                templateId: body.templateId,
              })
        return c.json(project, 201)
      },
    )
}

export function createProjectsRouter(deps: ProjectsDeps) {
  const ProjectParam = z.object({ id: ProjectIdSchema })

  return new Hono<AppEnv>().get('/:id', zValidator('param', ProjectParam), async (c) => {
    const userId = c.var.userId
    if (!userId) throw new UnauthorizedError()
    const { id } = c.req.valid('param')
    const { project, brand } = await requireProjectAccess(userId, id, deps.db)
    const canvas = await deps.db.getCanvasByProject(project.id)
    if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
    const [blocks, shortlist, sections, recentMessages] = await Promise.all([
      deps.db.listActiveBlocks(canvas.id),
      deps.db.getShortlistView(project.id),
      deps.db.listSectionsByBrand(brand.id),
      deps.db.listAgentMessages(project.id),
    ])
    const brandWithSections: BrandWithSections = { ...brand, sections }
    return c.json({
      ...project,
      canvas,
      blocks,
      shortlistBlockIds: shortlist.blockIds,
      recentMessages,
      brand: brandWithSections,
    })
  })
}
