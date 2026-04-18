import { z } from 'zod'
import { BrandIdSchema, SectionIdSchema } from '../ids'
import { ProseMirrorDocSchema } from '../json'

export const GuidelineSectionCreatedBySchema = z.enum(['user', 'agent'])
export type GuidelineSectionCreatedBy = z.infer<typeof GuidelineSectionCreatedBySchema>

export const BrandGuidelineSectionSchema = z.object({
  id: SectionIdSchema,
  brandId: BrandIdSchema,
  label: z.string().min(1).max(120),
  body: ProseMirrorDocSchema,
  // Sparse integer ordering. Reorders write a new `priority` without touching
  // siblings; re-balance on conflict. Swap for a lexorank string later if
  // reorder churn becomes a problem.
  priority: z.number().int(),
  createdBy: GuidelineSectionCreatedBySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type BrandGuidelineSection = z.infer<typeof BrandGuidelineSectionSchema>
