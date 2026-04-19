import { type Readable } from 'node:stream'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { type BlobBody, type BlobStore, BlobNotFoundError } from './port'

export interface SupabaseBlobStoreConfig {
  url: string
  serviceKey: string
  bucket: string
  defaultTtlSeconds?: number
}

const DEFAULT_TTL = 15 * 60

async function bytesFromBody(body: BlobBody): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body
  const chunks: Buffer[] = []
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike))
  }
  return Buffer.concat(chunks)
}

export function createSupabaseBlobStore(
  config: SupabaseBlobStoreConfig,
  deps: { client?: SupabaseClient } = {},
): BlobStore {
  const client = deps.client ?? createClient(config.url, config.serviceKey)
  const bucket = client.storage.from(config.bucket)
  const ttlDefault = config.defaultTtlSeconds ?? DEFAULT_TTL

  return {
    async put(key, body, opts) {
      const bytes = await bytesFromBody(body)
      const { error } = await bucket.upload(key, bytes, {
        contentType: opts?.contentType,
        upsert: true,
      })
      if (error) throw new Error(`supabase upload failed: ${error.message}`)
    },
    async get(key) {
      const { data, error } = await bucket.download(key)
      if (error || !data) {
        // Supabase surfaces a generic error; treat as not-found at the port level.
        throw new BlobNotFoundError(key)
      }
      const buf = Buffer.from(await data.arrayBuffer())
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    },
    async delete(key) {
      const { error } = await bucket.remove([key])
      if (error) throw new Error(`supabase delete failed: ${error.message}`)
    },
    async getSignedReadUrl(key, opts) {
      const { data, error } = await bucket.createSignedUrl(key, opts?.ttlSeconds ?? ttlDefault)
      if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message ?? 'no data'}`)
      return data.signedUrl
    },
    async getSignedWriteUrl(key, opts) {
      const { data, error } = await bucket.createSignedUploadUrl(key, {
        upsert: true,
      })
      if (error || !data) {
        throw new Error(`createSignedUploadUrl failed: ${error?.message ?? 'no data'}`)
      }
      const headers: Record<string, string> = {}
      if (opts?.contentType) headers['content-type'] = opts.contentType
      return { url: data.signedUrl, headers: Object.keys(headers).length > 0 ? headers : undefined }
    },
  }
}
