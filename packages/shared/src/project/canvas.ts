import { z } from 'zod'
import { CanvasBlockIdSchema, CanvasIdSchema, ProjectIdSchema } from '../ids'
import { ProseMirrorDocSchema } from '../json'

export const CanvasSchema = z.object({
  id: CanvasIdSchema,
  projectId: ProjectIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type Canvas = z.infer<typeof CanvasSchema>

export const CanvasBlockKindSchema = z.enum(['text', 'image', 'file'])
export type CanvasBlockKind = z.infer<typeof CanvasBlockKindSchema>

export const CanvasBlockCreatedBySchema = z.enum(['user', 'agent'])
export type CanvasBlockCreatedBy = z.infer<typeof CanvasBlockCreatedBySchema>

const CanvasBlockBaseShape = {
  id: CanvasBlockIdSchema,
  canvasId: CanvasIdSchema,
  // Integer position for deterministic ordering. Same rationale as
  // guideline-section priority — sparse integers, re-balance on conflict.
  position: z.number().int(),
  isPinned: z.boolean(),
  pinnedAt: z.iso.datetime().nullable(),
  createdBy: CanvasBlockCreatedBySchema,
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}

export const TextCanvasBlockSchema = z.object({
  ...CanvasBlockBaseShape,
  kind: z.literal('text'),
  body: ProseMirrorDocSchema,
})

export type TextCanvasBlock = z.infer<typeof TextCanvasBlockSchema>

export const ImageCanvasBlockSchema = z.object({
  ...CanvasBlockBaseShape,
  kind: z.literal('image'),
  blobKey: z.string().min(1),
  alt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export type ImageCanvasBlock = z.infer<typeof ImageCanvasBlockSchema>

export const FileCanvasBlockSchema = z.object({
  ...CanvasBlockBaseShape,
  kind: z.literal('file'),
  blobKey: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
})

export type FileCanvasBlock = z.infer<typeof FileCanvasBlockSchema>

export const CanvasBlockSchema = z.discriminatedUnion('kind', [
  TextCanvasBlockSchema,
  ImageCanvasBlockSchema,
  FileCanvasBlockSchema,
])

export type CanvasBlock = z.infer<typeof CanvasBlockSchema>

// Derived projection — not a stored entity. The server computes it as a
// filtered read over active, pinned blocks for a project
// (`is_pinned = true AND deleted_at IS NULL`); the schema exists so the
// wire shape is typed end-to-end.
export const ShortlistViewSchema = z.object({
  projectId: ProjectIdSchema,
  blockIds: z.array(CanvasBlockIdSchema),
})

export type ShortlistView = z.infer<typeof ShortlistViewSchema>
