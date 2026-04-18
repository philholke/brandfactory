import { z } from 'zod'
import { UserIdSchema, WorkspaceIdSchema } from '../ids'

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1).max(120),
  ownerUserId: UserIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type Workspace = z.infer<typeof WorkspaceSchema>
