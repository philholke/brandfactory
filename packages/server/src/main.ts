import { serve } from '@hono/node-server'
import { pool } from '@brandfactory/db'
import 'dotenv/config'
import type { Server as HttpServer } from 'node:http'
import { buildAdapters } from './adapters'
import { createAgentConcurrencyGuard } from './agent/concurrency'
import { createApp } from './app'
import { buildDbDeps } from './db'
import { loadEnv } from './env'
import { createLogger } from './logger'
import { mountRealtime, type MountRealtimeHandle } from './ws'

async function main(): Promise<void> {
  const env = loadEnv()
  const log = createLogger({ level: env.LOG_LEVEL })
  const adapters = buildAdapters(env)
  const db = buildDbDeps()
  // The Hono app only ever needs the pub/sub surface, so it takes the bus
  // out of the discriminated `RealtimeAdapter` here. The provider-specific
  // node-ws binder stays narrowed below.
  const agentGuard = createAgentConcurrencyGuard()
  const app = createApp({
    env,
    log,
    db,
    auth: adapters.auth,
    storage: adapters.storage,
    realtime: adapters.realtime.bus,
    llm: adapters.llm,
    agentGuard,
  })

  const server = serve(
    {
      fetch: app.fetch,
      port: env.PORT,
      hostname: env.HOST,
    },
    (info) => log.info('listening', { port: info.port, host: env.HOST }),
  ) as unknown as HttpServer

  // Only the native-ws realtime impl exposes `bindToNodeWebSocketServer`.
  // Narrowing on the discriminator forces every future impl to declare its
  // own upgrade strategy — the `never` assertion in the default branch
  // turns a missing case into a TS error.
  let ws: MountRealtimeHandle
  switch (adapters.realtime.provider) {
    case 'native-ws':
      ws = mountRealtime({
        httpServer: server,
        realtime: adapters.realtime.bus,
        auth: adapters.auth,
        db,
        log,
      })
      break
    default: {
      const _exhaustive: never = adapters.realtime.provider
      throw new Error(`unsupported realtime provider: ${String(_exhaustive)}`)
    }
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('shutdown: signal received', { signal })
    try {
      await ws.close()
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
      await pool.end()
      log.info('shutdown: complete')
      process.exit(0)
    } catch (err) {
      log.error('shutdown: failed', {
        name: (err as Error).name,
        message: (err as Error).message,
      })
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  // Pre-logger failures (env load, adapter build) land here.
  console.error(err)
  process.exit(1)
})
