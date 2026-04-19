import type { Hono } from 'hono'
import type { Logger } from './logger'

// Hono bindings + variables for the server. Route modules type their
// `new Hono<AppEnv>()` against `AppEnv` so `c.var.log` / `c.var.userId`
// resolve everywhere.

export type ServerBindings = Record<string, never>

export interface ServerVariables {
  requestId: string
  log: Logger
  userId?: string
}

export interface AppEnv {
  Bindings: ServerBindings
  Variables: ServerVariables
}

export type ServerHono = Hono<AppEnv>
