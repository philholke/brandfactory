import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalDiskBlobStore, verifySignature } from './local-disk'
import { BlobNotFoundError, InvalidSignatureError } from './port'

const SECRET = 'test-secret'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bf-blob-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function makeStore() {
  return createLocalDiskBlobStore({
    rootDir: root,
    signingSecret: SECRET,
    publicBaseUrl: 'http://localhost:3000/blobs',
  })
}

describe('local-disk blob store', () => {
  it('puts, gets, and deletes a Uint8Array body', async () => {
    const store = makeStore()
    const key = 'a/b/c.bin'
    const bytes = new Uint8Array([1, 2, 3, 4])
    await store.put(key, bytes)

    const onDisk = await readFile(join(root, key))
    expect(Array.from(onDisk)).toEqual([1, 2, 3, 4])

    const read = await store.get(key)
    expect(Array.from(read)).toEqual([1, 2, 3, 4])

    await store.delete(key)
    await expect(store.get(key)).rejects.toBeInstanceOf(BlobNotFoundError)
  })

  it('rejects keys that escape the storage root', async () => {
    const store = makeStore()
    await expect(store.put('../escape.bin', new Uint8Array([0]))).rejects.toThrow(/escapes/)
  })

  it('signs and verifies a read URL', async () => {
    const store = makeStore()
    const url = await store.getSignedReadUrl('foo/bar.png', { ttlSeconds: 60 })
    const parsed = new URL(url)
    const exp = Number(parsed.searchParams.get('exp'))
    const sig = parsed.searchParams.get('sig') ?? ''
    expect(parsed.pathname).toBe('/blobs/foo/bar.png')
    expect(() =>
      verifySignature({ method: 'GET', key: 'foo/bar.png', exp, sig, signingSecret: SECRET }),
    ).not.toThrow()
  })

  it('verify rejects an expired signature', () => {
    const expiredExp = Math.floor(Date.now() / 1000) - 10
    expect(() =>
      verifySignature({
        method: 'GET',
        key: 'k',
        exp: expiredExp,
        sig: 'deadbeef',
        signingSecret: SECRET,
      }),
    ).toThrow(InvalidSignatureError)
  })

  it('verify rejects a tampered key', async () => {
    const store = makeStore()
    const url = await store.getSignedReadUrl('original.png', { ttlSeconds: 60 })
    const parsed = new URL(url)
    const exp = Number(parsed.searchParams.get('exp'))
    const sig = parsed.searchParams.get('sig') ?? ''
    expect(() =>
      verifySignature({
        method: 'GET',
        key: 'tampered.png',
        exp,
        sig,
        signingSecret: SECRET,
      }),
    ).toThrow(InvalidSignatureError)
  })

  it('write URL uses PUT method in the signature', async () => {
    const store = makeStore()
    const { url, headers } = await store.getSignedWriteUrl('upload.png', {
      contentType: 'image/png',
      ttlSeconds: 30,
    })
    expect(headers?.['content-type']).toBe('image/png')
    const parsed = new URL(url)
    const exp = Number(parsed.searchParams.get('exp'))
    const sig = parsed.searchParams.get('sig') ?? ''
    expect(() =>
      verifySignature({ method: 'PUT', key: 'upload.png', exp, sig, signingSecret: SECRET }),
    ).not.toThrow()
    // GET signature for the same key/exp should NOT verify against the PUT sig.
    expect(() =>
      verifySignature({ method: 'GET', key: 'upload.png', exp, sig, signingSecret: SECRET }),
    ).toThrow(InvalidSignatureError)
  })
})
