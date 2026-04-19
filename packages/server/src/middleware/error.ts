import type { Context } from 'hono'
import { ZodError } from 'zod'
import type { AppEnv } from '../context'
import { HttpError } from '../errors'

export function onError(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof HttpError) {
    return c.json(
      {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      // `status` is narrowed by Hono to content-status; `satisfies` would
      // trip its conditional types, so cast through number.
      err.status as 400 | 401 | 403 | 404 | 409 | 500,
    )
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        code: 'VALIDATION',
        message: 'validation failed',
        details: err.issues,
      },
      400,
    )
  }
  const log = c.get('log')
  const userId = c.get('userId')
  log?.error('unhandled error', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    ...(userId !== undefined ? { userId } : {}),
  })
  return c.json(
    {
      code: 'INTERNAL',
      message: 'Internal Server Error',
    },
    500,
  )
}
