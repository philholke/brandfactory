import type { BlobStore } from '@brandfactory/adapter-storage'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

const TOKEN = 't-blobs'
const USER_ID = 'u-blobs'

function makeHarness(storage?: Partial<BlobStore>) {
  const fakeStorage: BlobStore = {
    async put() {},
    async get() {
      return new Uint8Array()
    },
    async delete() {},
    async getSignedReadUrl() {
      return 'http://signed-read'
    },
    async getSignedWriteUrl(key) {
      return { url: `http://signed-write/${key}`, headers: { 'x-custom': 'yes' } }
    },
    ...storage,
  }
  return createTestApp({
    users: [{ id: USER_ID, token: TOKEN }],
    storage: fakeStorage,
  })
}

const AUTH = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

describe('POST /blob-urls/upload-url', () => {
  it('returns 401 without auth', async () => {
    const { app } = makeHarness()
    const res = await app.request('/blob-urls/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'photo.jpg', contentType: 'image/jpeg', size: 1000 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for a disallowed content type', async () => {
    const { app } = makeHarness()
    const res = await app.request('/blob-urls/upload-url', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        filename: 'script.exe',
        contentType: 'application/x-msdownload',
        size: 1000,
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('INVALID_CONTENT_TYPE')
  })

  it('returns 413 when size exceeds limit', async () => {
    const { app } = makeHarness()
    const maxBytes = 25 * 1024 * 1024
    const res = await app.request('/blob-urls/upload-url', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ filename: 'big.jpg', contentType: 'image/jpeg', size: maxBytes + 1 }),
    })
    expect(res.status).toBe(413)
  })

  it('returns a signed write URL with key and headers', async () => {
    const { app } = makeHarness()
    const res = await app.request('/blob-urls/upload-url', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ filename: 'photo.jpg', contentType: 'image/jpeg', size: 1000 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { key: string; url: string; headers: Record<string, string> }
    expect(body.key).toMatch(/^uploads\/\d{4}\/\d{2}\/[0-9a-f-]+-photo\.jpg$/)
    expect(body.url).toContain('http://signed-write/')
    expect(body.headers?.['x-custom']).toBe('yes')
  })
})

describe('GET /blob-urls/:key/read-url', () => {
  it('returns 401 without auth', async () => {
    const { app } = makeHarness()
    const res = await app.request('/blob-urls/uploads/2024/04/uuid-photo.jpg/read-url')
    expect(res.status).toBe(401)
  })

  it('returns a signed read URL', async () => {
    const { app } = makeHarness()
    const res = await app.request('/blob-urls/uploads/2024/04/uuid-photo.jpg/read-url', {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toBe('http://signed-read')
  })
})
