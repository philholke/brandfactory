import { createHmac } from 'node:crypto'
import { BlobNotFoundError, type BlobStore } from '@brandfactory/adapter-storage'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

function sign(method: 'GET' | 'PUT', key: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${method}\n${key}\n${exp}`).digest('hex')
}

function buildStorage(): { store: BlobStore; written: Map<string, Uint8Array> } {
  const written = new Map<string, Uint8Array>()
  const store: BlobStore = {
    async put(key, body) {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body as unknown as ReadableStream).arrayBuffer())
      written.set(key, bytes)
    },
    async get(key) {
      const bytes = written.get(key)
      if (!bytes) throw new BlobNotFoundError(key)
      return bytes
    },
    async delete(key) {
      written.delete(key)
    },
    async getSignedReadUrl() {
      return 'http://signed'
    },
    async getSignedWriteUrl() {
      return { url: 'http://signed' }
    },
  }
  return { store, written }
}

const SECRET = 'test-secret'

describe('blobs routes', () => {
  it('PUT with a valid signature writes the bytes', async () => {
    const { store, written } = buildStorage()
    const { app } = createTestApp({ storage: store })
    const key = 'nested/path/hello.txt'
    const exp = Math.floor(Date.now() / 1000) + 60
    const sig = sign('PUT', key, exp, SECRET)
    const res = await app.request(`/blobs/${key}?exp=${exp}&sig=${sig}`, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
    })
    expect(res.status).toBe(200)
    expect(written.get(key)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('GET with a valid signature streams the bytes back', async () => {
    const { store } = buildStorage()
    const { app } = createTestApp({ storage: store })
    const key = 'hello.txt'
    const expPut = Math.floor(Date.now() / 1000) + 60
    await app.request(`/blobs/${key}?exp=${expPut}&sig=${sign('PUT', key, expPut, SECRET)}`, {
      method: 'PUT',
      body: new Uint8Array([7, 8, 9]),
    })
    const exp = Math.floor(Date.now() / 1000) + 60
    const res = await app.request(`/blobs/${key}?exp=${exp}&sig=${sign('GET', key, exp, SECRET)}`)
    expect(res.status).toBe(200)
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(buf)).toEqual([7, 8, 9])
  })

  it('expired signature → 403', async () => {
    const { store } = buildStorage()
    const { app } = createTestApp({ storage: store })
    const key = 'e.txt'
    const exp = Math.floor(Date.now() / 1000) - 1 // already expired
    const sig = sign('GET', key, exp, SECRET)
    const res = await app.request(`/blobs/${key}?exp=${exp}&sig=${sig}`)
    expect(res.status).toBe(403)
  })

  it('tampered signature → 403', async () => {
    const { store } = buildStorage()
    const { app } = createTestApp({ storage: store })
    const key = 't.txt'
    const exp = Math.floor(Date.now() / 1000) + 60
    const sig = sign('GET', key, exp, 'different-secret')
    const res = await app.request(`/blobs/${key}?exp=${exp}&sig=${sig}`)
    expect(res.status).toBe(403)
  })

  it('missing sig params → 400', async () => {
    const { app } = createTestApp()
    const res = await app.request('/blobs/whatever.txt')
    expect(res.status).toBe(400)
  })

  it('not mounted when STORAGE_PROVIDER=supabase', async () => {
    const { app } = createTestApp({
      env: {
        STORAGE_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://s.test',
        SUPABASE_SERVICE_KEY: 'sk',
        SUPABASE_STORAGE_BUCKET: 'b',
      },
    })
    const exp = Math.floor(Date.now() / 1000) + 60
    const res = await app.request(`/blobs/x?exp=${exp}&sig=abc`)
    expect(res.status).toBe(404)
  })
})
