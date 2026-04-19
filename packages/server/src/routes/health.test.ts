import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test-helpers'

describe('GET /health', () => {
  it('returns status ok + version without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', version: expect.any(String) })
  })
})
