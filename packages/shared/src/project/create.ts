import { z } from 'zod'

// Mirrors the discriminated shape of `Project` minus server-generated ids /
// timestamps. The route injects `brandId` from the path param.
export const CreateFreeformProjectInputSchema = z.object({
  kind: z.literal('freeform'),
  name: z.string().min(1).max(120),
})

export const CreateStandardizedProjectInputSchema = z.object({
  kind: z.literal('standardized'),
  name: z.string().min(1).max(120),
  templateId: z.string().min(1),
})

export const CreateProjectInputSchema = z.discriminatedUnion('kind', [
  CreateFreeformProjectInputSchema,
  CreateStandardizedProjectInputSchema,
])

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>

// Convenience for endpoints that hydrate the canvas alongside the project.
export type { ProjectKind } from './project'
