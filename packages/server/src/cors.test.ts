import { describe, expect, it } from 'vitest'
import { isOriginAllowed, parseCorsAllowedOrigins } from './cors'
import { createTestApp } from './test-helpers'

describe('parseCorsAllowedOrigins', () => {
  it('returns null when unset', () => {
    expect(parseCorsAllowedOrigins(undefined)).toBeNull()
    expect(parseCorsAllowedOrigins('')).toBeNull()
    expect(parseCorsAllowedOrigins('   ,  ,')).toBeNull()
  })

  it('splits comma-separated entries and trims whitespace', () => {
    expect(parseCorsAllowedOrigins('https://a.example, https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })
})

describe('isOriginAllowed', () => {
  it('allows anything when the allowlist is null (dev default)', () => {
    expect(isOriginAllowed('https://anywhere.example', null)).toBe(true)
    expect(isOriginAllowed(undefined, null)).toBe(true)
  })

  it('denies when allowlist is set but origin is absent', () => {
    expect(isOriginAllowed(undefined, ['https://app.example'])).toBe(false)
  })

  it('requires exact match when allowlist is set', () => {
    const list = ['https://app.example']
    expect(isOriginAllowed('https://app.example', list)).toBe(true)
    expect(isOriginAllowed('https://evil.example', list)).toBe(false)
  })
})

describe('CORS middleware mount (HTTP)', () => {
  it('does not set Access-Control-Allow-Origin when CORS_ALLOWED_ORIGINS is unset', async () => {
    const { app } = createTestApp()
    const res = await app.request('/health', {
      headers: { origin: 'https://app.example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('echoes an allowed origin on a simple request', async () => {
    const { app } = createTestApp({
      env: { CORS_ALLOWED_ORIGINS: 'https://app.example.com' },
    })
    const res = await app.request('/health', {
      headers: { origin: 'https://app.example.com' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
  })

  it('omits the header for a disallowed origin', async () => {
    const { app } = createTestApp({
      env: { CORS_ALLOWED_ORIGINS: 'https://app.example.com' },
    })
    const res = await app.request('/health', {
      headers: { origin: 'https://evil.example.com' },
    })
    // hono/cors returns the origin string or null — null ends up as a missing header.
    const allow = res.headers.get('access-control-allow-origin')
    expect(allow === null || allow === 'null').toBe(true)
    expect(allow).not.toBe('https://evil.example.com')
  })
})
