import { UpdateWorkspaceSettingsInputSchema, WorkspaceIdSchema } from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireWorkspaceAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import type { Env } from '../env'
import { UnauthorizedError } from '../errors'
import { resolveLLMSettings } from '../settings'

export interface SettingsDeps {
  db: Db
  env: Env
}

export function createSettingsRouter(deps: SettingsDeps) {
  const IdParam = z.object({ id: WorkspaceIdSchema })

  return new Hono<AppEnv>()
    .get('/:id/settings', zValidator('param', IdParam), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { id } = c.req.valid('param')
      await requireWorkspaceAccess(userId, id, deps.db)
      const resolved = await resolveLLMSettings(id, deps.env, deps.db)
      return c.json(resolved)
    })
    .patch(
      '/:id/settings',
      zValidator('param', IdParam),
      zValidator('json', UpdateWorkspaceSettingsInputSchema),
      async (c) => {
        const userId = c.var.userId
        if (!userId) throw new UnauthorizedError()
        const { id } = c.req.valid('param')
        await requireWorkspaceAccess(userId, id, deps.db)
        const body = c.req.valid('json')
        await deps.db.upsertWorkspaceSettings({
          workspaceId: id,
          llmProviderId: body.llmProviderId,
          llmModel: body.llmModel,
        })
        const resolved = await resolveLLMSettings(id, deps.env, deps.db)
        return c.json(resolved)
      },
    )
}
