import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseBlobStore } from './supabase'

// Hand-rolled stand-in for the slice of SupabaseClient.storage.from(bucket)
// that the adapter touches. Avoids spinning up @supabase/supabase-js in test.
function makeFakeClient() {
  const calls: Record<string, unknown[]> = {
    upload: [],
    download: [],
    remove: [],
    createSignedUrl: [],
    createSignedUploadUrl: [],
  }
  const bucket = {
    upload: async (key: string, bytes: Uint8Array, opts: unknown) => {
      calls.upload?.push({ key, bytes, opts })
      return { data: { path: key }, error: null }
    },
    download: async (key: string) => {
      calls.download?.push({ key })
      return {
        data: new Blob([new Uint8Array([7, 8, 9])]),
        error: null,
      }
    },
    remove: async (keys: string[]) => {
      calls.remove?.push({ keys })
      return { data: keys.map((k) => ({ name: k })), error: null }
    },
    createSignedUrl: async (key: string, ttl: number) => {
      calls.createSignedUrl?.push({ key, ttl })
      return { data: { signedUrl: `https://signed.test/${key}?ttl=${ttl}` }, error: null }
    },
    createSignedUploadUrl: async (key: string, opts: unknown) => {
      calls.createSignedUploadUrl?.push({ key, opts })
      return {
        data: { signedUrl: `https://upload.test/${key}`, token: 'tok', path: key },
        error: null,
      }
    },
  }
  const client = {
    storage: { from: (_bucket: string) => bucket },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('supabase blob store', () => {
  it('round-trips put/get and writes the right options', async () => {
    const { client, calls } = makeFakeClient()
    const store = createSupabaseBlobStore(
      { url: 'http://test', serviceKey: 'k', bucket: 'blobs' },
      { client },
    )
    await store.put('hello.txt', new Uint8Array([1, 2, 3]), { contentType: 'text/plain' })
    expect(calls.upload).toHaveLength(1)
    const got = await store.get('hello.txt')
    expect(Array.from(got)).toEqual([7, 8, 9])
  })

  it('produces signed read and write URLs', async () => {
    const { client } = makeFakeClient()
    const store = createSupabaseBlobStore(
      { url: 'http://test', serviceKey: 'k', bucket: 'blobs', defaultTtlSeconds: 120 },
      { client },
    )
    expect(await store.getSignedReadUrl('a.png')).toContain('ttl=120')
    const w = await store.getSignedWriteUrl('a.png', { contentType: 'image/png' })
    expect(w.url).toContain('upload.test')
    expect(w.headers?.['content-type']).toBe('image/png')
  })
})
