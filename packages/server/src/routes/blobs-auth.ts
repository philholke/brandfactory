import type { BlobStore } from '@brandfactory/adapter-storage'
import { ALLOWED_UPLOAD_MIMES, BlobUploadRequestSchema } from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { HttpError, UnauthorizedError } from '../errors'
import { randomUUID } from 'node:crypto'

export interface BlobUrlsDeps {
  storage: BlobStore
  maxBytes: number
}

export function createBlobUrlsRouter(deps: BlobUrlsDeps) {
  return new Hono<AppEnv>()
    .post('/upload-url', zValidator('json', BlobUploadRequestSchema), async (c) => {
      const userId = c.var.userId
      if (!userId) throw new UnauthorizedError()
      const { filename, contentType, size } = c.req.valid('json')

      if (!(ALLOWED_UPLOAD_MIMES as readonly string[]).includes(contentType)) {
        throw new HttpError(400, 'INVALID_CONTENT_TYPE', `content type not allowed: ${contentType}`)
      }
      if (size > deps.maxBytes) {
        throw new HttpError(413, 'BLOB_TOO_LARGE', `upload exceeds ${deps.maxBytes} bytes`)
      }

      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
      const key = `uploads/${yyyy}/${mm}/${randomUUID()}-${safeName}`

      const { url, headers } = await deps.storage.getSignedWriteUrl(key, {
        contentType,
        ttlSeconds: 300,
      })

      return c.json({ key, url, ...(headers ? { headers } : {}) })
    })
    .get(
      // Multi-segment key (e.g. uploads/2024/04/uuid-name) captured by {.+}.
      '/:key{.+}/read-url',
      zValidator('param', z.object({ key: z.string().min(1) })),
      async (c) => {
        const userId = c.var.userId
        if (!userId) throw new UnauthorizedError()
        const { key } = c.req.valid('param')
        const url = await deps.storage.getSignedReadUrl(key, { ttlSeconds: 300 })
        return c.json({ url })
      },
    )
}
