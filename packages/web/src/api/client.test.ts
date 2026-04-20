import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, callJson } from './client'
import { useAuthStore } from '@/auth/store'

describe('callJson', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 'tok', userId: 'u1' })
  })

  afterEach(() => {
    useAuthStore.setState({ token: null, userId: null })
  })

  it('parses JSON on 2xx', async () => {
    const res = new Response(JSON.stringify({ hello: 'world' }), { status: 200 })
    await expect(callJson<{ hello: string }>(res)).resolves.toEqual({ hello: 'world' })
  })

  it('throws AppError with server-supplied code + message on non-2xx', async () => {
    const res = new Response(JSON.stringify({ code: 'BAD_THING', message: 'Nope' }), {
      status: 400,
      statusText: 'Bad Request',
    })
    await expect(callJson(res)).rejects.toMatchObject({
      name: 'AppError',
      code: 'BAD_THING',
      message: 'Nope',
      status: 400,
    })
  })

  it('falls back to statusText when the error body is not JSON', async () => {
    const res = new Response('<html>boom</html>', { status: 500, statusText: 'Server Error' })
    const err = await callJson(res).catch((e) => e as AppError)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('UNKNOWN')
    expect((err as AppError).status).toBe(500)
  })

  it('logs the user out on 401', async () => {
    const logout = vi.fn()
    useAuthStore.setState({ token: 'tok', userId: 'u1', logout })
    const res = new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 })
    await callJson(res).catch(() => undefined)
    expect(logout).toHaveBeenCalled()
  })
})

describe('AppError', () => {
  it('carries name, code, status, and message', () => {
    const err = new AppError('boom', 'X', 418)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AppError')
    expect(err.code).toBe('X')
    expect(err.status).toBe(418)
    expect(err.message).toBe('boom')
  })
})
