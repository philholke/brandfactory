import { Hono } from 'hono'
import type { AppEnv } from '../context'

// Version string read once at module load. The server package isn't
// published, so `0.0.0` is fine; the changelog is the source of truth.
const VERSION = '0.0.0'

export function createHealthRouter() {
  return new Hono<AppEnv>().get('/', (c) => c.json({ status: 'ok', version: VERSION }))
}
