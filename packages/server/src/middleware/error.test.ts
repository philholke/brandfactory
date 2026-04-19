import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { HttpError, NotFoundError } from '../errors'
import { silentLogger } from '../test-helpers'
import { onError } from './error'

function makeApp() {
  const app = new Hono<AppEnv>()
  // `onError` reads `c.var.log` — attach a silent logger so the unhandled
  // branch doesn't spam test output.
  app.use('*', async (c, next) => {
    c.set('log', silentLogger())
    await next()
  })
  app.onError(onError)
  app.get('/http', () => {
    throw new NotFoundError('nope', 'X_NOT_FOUND')
  })
  app.get('/http-details', () => {
    throw new HttpError(418, 'TEAPOT', 'short and stout', { hint: 'brew' })
  })
  app.get('/zod', () => {
    z.object({ a: z.string() }).parse({})
    return new Response('unreachable')
  })
  app.get('/unknown', () => {
    throw new Error('boom')
  })
  return app
}

describe('onError', () => {
  it('maps HttpError to its status + code', async () => {
    const res = await makeApp().request('/http')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'X_NOT_FOUND', message: 'nope' })
  })

  it('includes details when present', async () => {
    const res = await makeApp().request('/http-details')
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({
      code: 'TEAPOT',
      message: 'short and stout',
      details: { hint: 'brew' },
    })
  })

  it('maps ZodError to 400 VALIDATION with issues', async () => {
    const res = await makeApp().request('/zod')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; details: unknown[] }
    expect(body.code).toBe('VALIDATION')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('returns 500 INTERNAL for unknown errors and logs the stack', async () => {
    const writes: string[] = []
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('log', {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: (msg, fields) => writes.push(JSON.stringify({ msg, fields })),
        child: () => c.var.log,
      })
      await next()
    })
    app.onError(onError)
    app.get('/boom', () => {
      throw new Error('boom')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ code: 'INTERNAL', message: 'Internal Server Error' })
    expect(writes.some((w) => w.includes('unhandled error'))).toBe(true)
  })
})
