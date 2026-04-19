import { randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context'

export function requestIdMiddleware() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const incoming = c.req.header('x-request-id')
    const requestId = incoming && incoming.length > 0 ? incoming : randomUUID()
    c.set('requestId', requestId)
    c.header('x-request-id', requestId)
    await next()
  })
}
