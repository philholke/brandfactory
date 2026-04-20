import { z } from 'zod'
import { AgentMessageSchema } from '../agent/events'
import { BrandWithSectionsSchema } from '../brand/brand'
import { CanvasBlockIdSchema } from '../ids'
import { CanvasBlockSchema, CanvasSchema } from './canvas'
import { ProjectSchema } from './project'

export const ProjectDetailSchema = z.intersection(
  ProjectSchema,
  z.object({
    canvas: CanvasSchema,
    blocks: z.array(CanvasBlockSchema),
    shortlistBlockIds: z.array(CanvasBlockIdSchema),
    recentMessages: z.array(AgentMessageSchema),
    brand: BrandWithSectionsSchema,
  }),
)

export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
