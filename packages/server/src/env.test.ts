import { describe, expect, it } from 'vitest'
import { loadEnv } from './env'

const baseLocal = {
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
}

describe('loadEnv', () => {
  it('parses a happy local config', () => {
    const env = loadEnv(baseLocal as NodeJS.ProcessEnv)
    expect(env.AUTH_PROVIDER).toBe('local')
    expect(env.STORAGE_PROVIDER).toBe('local-disk')
    expect(env.LLM_PROVIDER).toBe('openrouter')
  })

  it('parses a happy supabase config', () => {
    const env = loadEnv({
      ...baseLocal,
      AUTH_PROVIDER: 'supabase',
      STORAGE_PROVIDER: 'supabase',
      LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'a_key',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_JWKS_URL: 'https://supabase.test/.well-known/jwks.json',
      SUPABASE_SERVICE_KEY: 'sk',
      SUPABASE_STORAGE_BUCKET: 'blobs',
      // local-disk vars no longer required:
      BLOB_LOCAL_DISK_ROOT: undefined,
      BLOB_SIGNING_SECRET: undefined,
      BLOB_PUBLIC_BASE_URL: undefined,
      OPENROUTER_API_KEY: undefined,
    } as unknown as NodeJS.ProcessEnv)
    expect(env.AUTH_PROVIDER).toBe('supabase')
    expect(env.LLM_PROVIDER).toBe('anthropic')
  })

  it('rejects supabase auth without a JWKS url', () => {
    expect(() =>
      loadEnv({
        ...baseLocal,
        AUTH_PROVIDER: 'supabase',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/SUPABASE_JWKS_URL/)
  })

  it('rejects local-disk storage without signing secret', () => {
    expect(() =>
      loadEnv({
        ...baseLocal,
        BLOB_SIGNING_SECRET: undefined,
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/BLOB_SIGNING_SECRET/)
  })

  it('rejects anthropic LLM without ANTHROPIC_API_KEY', () => {
    expect(() =>
      loadEnv({
        ...baseLocal,
        LLM_PROVIDER: 'anthropic',
        OPENROUTER_API_KEY: undefined,
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/ANTHROPIC_API_KEY/)
  })

  it('allows ollama with no per-provider key', () => {
    const env = loadEnv({
      ...baseLocal,
      LLM_PROVIDER: 'ollama',
      OPENROUTER_API_KEY: undefined,
    } as unknown as NodeJS.ProcessEnv)
    expect(env.LLM_PROVIDER).toBe('ollama')
  })

  it('rejects supabase storage missing all three required fields', () => {
    let err: Error | undefined
    try {
      loadEnv({
        ...baseLocal,
        STORAGE_PROVIDER: 'supabase',
        BLOB_LOCAL_DISK_ROOT: undefined,
        BLOB_SIGNING_SECRET: undefined,
        BLOB_PUBLIC_BASE_URL: undefined,
      } as unknown as NodeJS.ProcessEnv)
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/SUPABASE_URL/)
    expect(err?.message).toMatch(/SUPABASE_SERVICE_KEY/)
    expect(err?.message).toMatch(/SUPABASE_STORAGE_BUCKET/)
  })

  it('reports every failure in a single error when multiple conditions are violated', () => {
    let err: Error | undefined
    try {
      loadEnv({
        ...baseLocal,
        AUTH_PROVIDER: 'supabase',
        STORAGE_PROVIDER: 'supabase',
        LLM_PROVIDER: 'anthropic',
        BLOB_LOCAL_DISK_ROOT: undefined,
        BLOB_SIGNING_SECRET: undefined,
        BLOB_PUBLIC_BASE_URL: undefined,
        OPENROUTER_API_KEY: undefined,
      } as unknown as NodeJS.ProcessEnv)
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(Error)
    // supabase auth + supabase storage + anthropic LLM all missing config:
    expect(err?.message).toMatch(/SUPABASE_JWKS_URL/)
    expect(err?.message).toMatch(/SUPABASE_URL/)
    expect(err?.message).toMatch(/SUPABASE_SERVICE_KEY/)
    expect(err?.message).toMatch(/SUPABASE_STORAGE_BUCKET/)
    expect(err?.message).toMatch(/ANTHROPIC_API_KEY/)
  })
})
