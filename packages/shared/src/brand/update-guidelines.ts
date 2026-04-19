import { z } from 'zod'
import { SectionIdSchema } from '../ids'
import { ProseMirrorDocSchema } from '../json'

// Upsert-and-reorder over the full section list. `id` present → update that
// row; `id` absent → insert. Section deletion is out of scope for Phase 4 and
// arrives with shortlist promotion (Phase 5/6).
export const UpdateBrandGuidelinesSectionInputSchema = z.object({
  id: SectionIdSchema.optional(),
  label: z.string().min(1).max(120),
  body: ProseMirrorDocSchema,
  priority: z.number().int(),
})

export type UpdateBrandGuidelinesSectionInput = z.infer<
  typeof UpdateBrandGuidelinesSectionInputSchema
>

export const UpdateBrandGuidelinesInputSchema = z.object({
  sections: z.array(UpdateBrandGuidelinesSectionInputSchema),
})

export type UpdateBrandGuidelinesInput = z.infer<typeof UpdateBrandGuidelinesInputSchema>
