import { z } from 'zod'
import { BrandIdSchema, ProjectIdSchema } from '../ids'

export const ProjectKindSchema = z.enum(['freeform', 'standardized'])
export type ProjectKind = z.infer<typeof ProjectKindSchema>

const ProjectBaseShape = {
  id: ProjectIdSchema,
  brandId: BrandIdSchema,
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}

export const FreeformProjectSchema = z.object({
  ...ProjectBaseShape,
  kind: z.literal('freeform'),
})

export type FreeformProject = z.infer<typeof FreeformProjectSchema>

export const StandardizedProjectSchema = z.object({
  ...ProjectBaseShape,
  kind: z.literal('standardized'),
  templateId: z.string().min(1),
})

export type StandardizedProject = z.infer<typeof StandardizedProjectSchema>

export const ProjectSchema = z.discriminatedUnion('kind', [
  FreeformProjectSchema,
  StandardizedProjectSchema,
])

export type Project = z.infer<typeof ProjectSchema>
