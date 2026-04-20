import { ProjectIdSchema } from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireProjectAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import { UnauthorizedError } from '../errors'

export interface MessagesDeps {
  db: Db
}

const ProjectParam = z.object({ id: ProjectIdSchema })
const MessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export function createMessagesRouter(deps: MessagesDeps) {
  return new Hono<AppEnv>().get(
    '/:id/messages',
    zValidator('param', ProjectParam),
    zValidator('query', MessagesQuery),
    async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { id } = c.req.valid('param')
      const { limit } = c.req.valid('query')
      const { project } = await requireProjectAccess(userId, id, deps.db)
      return c.json(await deps.db.listAgentMessages(project.id, { limit }))
    },
  )
}
