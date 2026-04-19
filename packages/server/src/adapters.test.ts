import { describe, expect, it } from 'vitest'
import { buildAdapters } from './adapters'
import { loadEnv } from './env'

describe('buildAdapters', () => {
  it('wires the four adapters for the local + native-ws + openrouter combo', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      AUTH_PROVIDER: 'local',
      STORAGE_PROVIDER: 'local-disk',
      REALTIME_PROVIDER: 'native-ws',
      LLM_PROVIDER: 'openrouter',
      LLM_MODEL: 'anthropic/claude-sonnet-4.6',
      BLOB_LOCAL_DISK_ROOT: '/tmp/blobs',
      BLOB_SIGNING_SECRET: 'sec',
      BLOB_PUBLIC_BASE_URL: 'http://localhost:3000/blobs',
      OPENROUTER_API_KEY: 'or_key',
    } as NodeJS.ProcessEnv)

    const { auth, storage, realtime, llm } = buildAdapters(env)

    expect(typeof auth.verifyToken).toBe('function')
    expect(typeof auth.getUserById).toBe('function')
    expect(typeof storage.put).toBe('function')
    expect(typeof storage.getSignedReadUrl).toBe('function')
    expect(realtime.provider).toBe('native-ws')
    expect(typeof realtime.bus.publish).toBe('function')
    expect(typeof realtime.bus.subscribe).toBe('function')
    expect(typeof realtime.bus.bindToNodeWebSocketServer).toBe('function')
    expect(typeof llm.getModel).toBe('function')
  })
})
