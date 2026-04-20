import { z } from 'zod'
import { ProseMirrorDocSchema } from '../json'

export const CreateTextCanvasBlockInputSchema = z.object({
  kind: z.literal('text'),
  body: ProseMirrorDocSchema,
  position: z.number().int().optional(),
})

export const CreateImageCanvasBlockInputSchema = z.object({
  kind: z.literal('image'),
  blobKey: z.string().min(1),
  alt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  position: z.number().int().optional(),
})

export const CreateFileCanvasBlockInputSchema = z.object({
  kind: z.literal('file'),
  blobKey: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  position: z.number().int().optional(),
})

export const CreateCanvasBlockInputSchema = z.discriminatedUnion('kind', [
  CreateTextCanvasBlockInputSchema,
  CreateImageCanvasBlockInputSchema,
  CreateFileCanvasBlockInputSchema,
])

export type CreateCanvasBlockInput = z.infer<typeof CreateCanvasBlockInputSchema>

// Patch is open — callers update any subset of mutable fields. Kind is
// immutable; to change kind, delete the block and create a new one.
export const UpdateCanvasBlockInputSchema = z.object({
  position: z.number().int().optional(),
  body: ProseMirrorDocSchema.optional(),
  alt: z.string().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
})

export type UpdateCanvasBlockInput = z.infer<typeof UpdateCanvasBlockInputSchema>
