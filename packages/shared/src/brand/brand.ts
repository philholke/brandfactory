import { z } from 'zod'
import { BrandIdSchema, WorkspaceIdSchema } from '../ids'
import { BrandGuidelineSectionSchema } from './guideline-section'

export const BrandSchema = z.object({
  id: BrandIdSchema,
  workspaceId: WorkspaceIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type Brand = z.infer<typeof BrandSchema>

// Lightweight projection for brand lists / pickers — avoids fetching full
// guideline sections for surfaces that only need to display the brand name.
export const BrandSummarySchema = BrandSchema.pick({
  id: true,
  workspaceId: true,
  name: true,
})

export type BrandSummary = z.infer<typeof BrandSummarySchema>

// Composed view returned by endpoints that hydrate sections alongside the
// brand row. Sections are stored in their own table (see Phase 2); this is
// the API-level join, not a storage shape.
export const BrandWithSectionsSchema = BrandSchema.extend({
  sections: z.array(BrandGuidelineSectionSchema),
})

export type BrandWithSections = z.infer<typeof BrandWithSectionsSchema>
