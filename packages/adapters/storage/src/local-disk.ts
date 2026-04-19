import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { type BlobBody, type BlobStore, BlobNotFoundError, InvalidSignatureError } from './port'

export interface LocalDiskBlobStoreConfig {
  rootDir: string
  signingSecret: string
  // Public base URL the server exposes for signed access.
  // Example: https://app.example.com/blobs  → signed URL is `${base}/${key}?...`
  publicBaseUrl: string
  defaultTtlSeconds?: number
}

const DEFAULT_TTL = 15 * 60 // 15 minutes

export function createLocalDiskBlobStore(config: LocalDiskBlobStoreConfig): BlobStore {
  const root = resolve(config.rootDir)
  const ttlDefault = config.defaultTtlSeconds ?? DEFAULT_TTL

  async function bytesFromBody(body: BlobBody): Promise<Uint8Array> {
    if (body instanceof Uint8Array) return body
    const chunks: Buffer[] = []
    for await (const chunk of body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike))
    }
    return Buffer.concat(chunks)
  }

  function resolveKey(key: string): string {
    if (key.length === 0) throw new Error('blob key is empty')
    const target = resolve(root, key)
    // Defense-in-depth against path traversal: resolved path must stay under root.
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`blob key escapes storage root: ${key}`)
    }
    return target
  }

  function sign(method: 'GET' | 'PUT', key: string, exp: number): string {
    return createHmac('sha256', config.signingSecret)
      .update(`${method}\n${key}\n${exp}`)
      .digest('hex')
  }

  function buildUrl(method: 'GET' | 'PUT', key: string, ttlSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds
    const sig = sign(method, key, exp)
    const base = config.publicBaseUrl.replace(/\/$/, '')
    return `${base}/${encodeURI(key)}?exp=${exp}&sig=${sig}`
  }

  return {
    async put(key, body, _opts) {
      const target = resolveKey(key)
      await mkdir(dirname(target), { recursive: true })
      const bytes = await bytesFromBody(body)
      await writeFile(target, bytes)
    },
    async get(key) {
      const target = resolveKey(key)
      try {
        const buf = await readFile(target)
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT') throw new BlobNotFoundError(key)
        throw err
      }
    },
    async delete(key) {
      const target = resolveKey(key)
      await rm(target, { force: true })
    },
    async getSignedReadUrl(key, opts) {
      return buildUrl('GET', key, opts?.ttlSeconds ?? ttlDefault)
    },
    async getSignedWriteUrl(key, opts) {
      const url = buildUrl('PUT', key, opts?.ttlSeconds ?? ttlDefault)
      const headers: Record<string, string> = {}
      if (opts?.contentType) headers['content-type'] = opts.contentType
      return { url, headers: Object.keys(headers).length > 0 ? headers : undefined }
    },
  }
}

export interface VerifySignatureInput {
  method: 'GET' | 'PUT'
  key: string
  exp: number
  sig: string
  signingSecret: string
  now?: number
}

// Reused by the server's blob HTTP handler (Phase 4) to check signed URLs.
// Throws InvalidSignatureError on any failure.
export function verifySignature(input: VerifySignatureInput): void {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  if (!Number.isFinite(input.exp) || input.exp < now) {
    throw new InvalidSignatureError('signature expired')
  }
  const expected = createHmac('sha256', input.signingSecret)
    .update(`${input.method}\n${input.key}\n${input.exp}`)
    .digest()
  let provided: Buffer
  try {
    provided = Buffer.from(input.sig, 'hex')
  } catch {
    throw new InvalidSignatureError('signature is not hex')
  }
  if (provided.length !== expected.length) {
    throw new InvalidSignatureError('signature length mismatch')
  }
  if (!timingSafeEqual(provided, expected)) {
    throw new InvalidSignatureError('signature mismatch')
  }
}
