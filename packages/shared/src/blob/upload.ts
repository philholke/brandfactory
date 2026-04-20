import { z } from 'zod'

// Content types the server accepts for user uploads. Validated server-side;
// the client sends the declared contentType and the server rejects anything
// not on this list before minting a signed write URL.
export const ALLOWED_UPLOAD_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const

export type AllowedUploadMime = (typeof ALLOWED_UPLOAD_MIMES)[number]

export const BlobUploadRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().min(1),
})

export type BlobUploadRequest = z.infer<typeof BlobUploadRequestSchema>

export const BlobUploadResponseSchema = z.object({
  key: z.string().min(1),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
})

export type BlobUploadResponse = z.infer<typeof BlobUploadResponseSchema>

export const BlobReadUrlResponseSchema = z.object({
  url: z.string().min(1),
})

export type BlobReadUrlResponse = z.infer<typeof BlobReadUrlResponseSchema>
