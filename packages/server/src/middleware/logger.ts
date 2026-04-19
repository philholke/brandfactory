import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../context'
import type { Logger } from '../logger'

export function loggerMiddleware(root: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const log = root.child({ requestId: c.var.requestId })
    c.set('log', log)
    const started = Date.now()
    try {
      await next()
    } finally {
      const durationMs = Date.now() - started
      log.info('request', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
        userId: c.var.userId,
      })
    }
  })
}
