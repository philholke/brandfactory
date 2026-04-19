import { z } from 'zod'

export const CreateBrandInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
})

export type CreateBrandInput = z.infer<typeof CreateBrandInputSchema>
