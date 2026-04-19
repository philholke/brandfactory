// Blob store port. Same surface for local-disk dev storage and any future
// cloud impl (Supabase Storage today; S3/GCS later). Signed URLs are first-
// class so the browser can read images via `<img src>` and POST uploads
// directly without the server proxying bytes.

export interface BlobReadOptions {
  ttlSeconds?: number
}

export interface BlobWriteOptions {
  ttlSeconds?: number
  contentType?: string
}

export interface SignedWriteUrl {
  url: string
  // Headers the client MUST send on the upload request (e.g. content-type,
  // x-upsert). Empty for impls that don't require any.
  headers?: Record<string, string>
}

export type BlobBody = Uint8Array | NodeJS.ReadableStream

export interface BlobStore {
  put(key: string, body: BlobBody, opts?: { contentType?: string }): Promise<void>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
  getSignedReadUrl(key: string, opts?: BlobReadOptions): Promise<string>
  getSignedWriteUrl(key: string, opts?: BlobWriteOptions): Promise<SignedWriteUrl>
}

export class BlobNotFoundError extends Error {
  constructor(key: string) {
    super(`blob not found: ${key}`)
    this.name = 'BlobNotFoundError'
  }
}

export class InvalidSignatureError extends Error {
  constructor(message = 'invalid blob signature') {
    super(message)
    this.name = 'InvalidSignatureError'
  }
}
