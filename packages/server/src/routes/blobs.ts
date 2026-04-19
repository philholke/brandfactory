import { BlobNotFoundError, verifySignature, type BlobStore } from '@brandfactory/adapter-storage'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { ForbiddenError, HttpError } from '../errors'

export interface BlobsDeps {
  storage: BlobStore
  signingSecret: string
  maxBytes: number
}

const KeyParam = z.object({ key: z.string().min(1) })
const SigQuery = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(1),
})

// Mounted only when `STORAGE_PROVIDER === 'local-disk'`. Supabase Storage
// serves signed URLs directly, so the server never sees those bytes.
export function createBlobsRouter(deps: BlobsDeps) {
  return new Hono<AppEnv>()
    .get('/:key{.+}', zValidator('param', KeyParam), zValidator('query', SigQuery), async (c) => {
      const { key } = c.req.valid('param')
      const { exp, sig } = c.req.valid('query')
      try {
        verifySignature({ method: 'GET', key, exp, sig, signingSecret: deps.signingSecret })
      } catch {
        throw new ForbiddenError('invalid signature')
      }
      let bytes: Uint8Array
      try {
        bytes = await deps.storage.get(key)
      } catch (err) {
        // Callers with a valid signature against a missing key get a 404;
        // any other error bubbles to onError's 500 branch.
        if (err instanceof BlobNotFoundError) {
          throw new HttpError(404, 'BLOB_NOT_FOUND', 'blob not found')
        }
        throw err
      }
      // Content-type persistence is a Phase 8 polish (plan task 4); the
      // Phase 4 default keeps uploads honest without a schema change.
      return new Response(bytes, {
        headers: { 'content-type': 'application/octet-stream' },
      })
    })
    .put('/:key{.+}', zValidator('param', KeyParam), zValidator('query', SigQuery), async (c) => {
      const { key } = c.req.valid('param')
      const { exp, sig } = c.req.valid('query')
      try {
        verifySignature({ method: 'PUT', key, exp, sig, signingSecret: deps.signingSecret })
      } catch {
        throw new ForbiddenError('invalid signature')
      }
      // Reject obviously oversized uploads before reading any bytes. A
      // signed-URL holder is authenticated, so the realistic risk is OOM
      // rather than abuse, but the check is one line.
      const declared = c.req.header('content-length')
      if (declared !== undefined) {
        const n = Number(declared)
        if (Number.isFinite(n) && n > deps.maxBytes) {
          throw new HttpError(413, 'BLOB_TOO_LARGE', `blob exceeds ${deps.maxBytes} bytes`)
        }
      }
      const buf = await c.req.arrayBuffer()
      // Belt + suspenders for clients that omit / lie about `content-length`.
      if (buf.byteLength > deps.maxBytes) {
        throw new HttpError(413, 'BLOB_TOO_LARGE', `blob exceeds ${deps.maxBytes} bytes`)
      }
      const bytes = new Uint8Array(buf)
      const contentType = c.req.header('content-type') ?? undefined
      await deps.storage.put(key, bytes, contentType ? { contentType } : undefined)
      return c.json({ key })
    })
}
