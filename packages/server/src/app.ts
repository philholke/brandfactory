import type { AuthProvider } from '@brandfactory/adapter-auth'
import type { BlobStore } from '@brandfactory/adapter-storage'
import type { LLMProvider } from '@brandfactory/adapter-llm'
import type { RealtimeBus } from '@brandfactory/adapter-realtime'
import { Hono } from 'hono'
import type { AppEnv } from './context'
import type { Db } from './db'
import type { Env } from './env'
import type { Logger } from './logger'
import { createAuthMiddleware, createOptionalAuthMiddleware } from './middleware/auth'
import { onError } from './middleware/error'
import { loggerMiddleware } from './middleware/logger'
import { requestIdMiddleware } from './middleware/request-id'
import type { AgentConcurrencyGuard } from './agent/concurrency'
import { createAgentRouter } from './routes/agent'
import { createBlobsRouter } from './routes/blobs'
import { createBrandsRouter, createWorkspaceBrandsRouter } from './routes/brands'
import { createHealthRouter } from './routes/health'
import { createMeRouter } from './routes/me'
import { createBrandProjectsRouter, createProjectsRouter } from './routes/projects'
import { createSettingsRouter } from './routes/settings'
import { createWorkspacesRouter } from './routes/workspaces'

export interface AppDeps {
  env: Env
  log: Logger
  db: Db
  auth: AuthProvider
  storage: BlobStore
  realtime: RealtimeBus
  llm: LLMProvider
  agentGuard: AgentConcurrencyGuard
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  app.use('*', requestIdMiddleware())
  app.use('*', loggerMiddleware(deps.log))
  app.onError(onError)

  // `/health` gets optional auth so an authed probe is attributable but an
  // unauthenticated curl still works.
  app.use('/health/*', createOptionalAuthMiddleware(deps.auth))

  // Auth-required path prefixes. Scoping middleware per-prefix (rather than
  // behind a sub-app at `/`) keeps `/blobs`, `/health`, and `/rt`'s HTTP
  // surface outside the auth gate — the signed URL is the capability for
  // blobs, and `/rt` terminates at the ws upgrade handler, not HTTP.
  const authRequired = createAuthMiddleware(deps.auth)
  app.use('/me/*', authRequired)
  app.use('/workspaces/*', authRequired)
  app.use('/brands/*', authRequired)
  app.use('/projects/*', authRequired)

  const composed = app
    .route('/health', createHealthRouter())
    .route('/me', createMeRouter({ auth: deps.auth }))
    .route('/workspaces', createWorkspacesRouter({ db: deps.db }))
    .route('/workspaces', createWorkspaceBrandsRouter({ db: deps.db }))
    .route('/workspaces', createSettingsRouter({ db: deps.db, env: deps.env }))
    .route('/brands', createBrandsRouter({ db: deps.db }))
    .route('/brands', createBrandProjectsRouter({ db: deps.db }))
    .route('/projects', createProjectsRouter({ db: deps.db }))
    .route(
      '/projects',
      createAgentRouter({
        db: deps.db,
        env: deps.env,
        llm: deps.llm,
        realtime: deps.realtime,
        agentGuard: deps.agentGuard,
      }),
    )

  if (deps.env.STORAGE_PROVIDER === 'local-disk') {
    // Blob routes are not auth-gated — the signed URL is the capability.
    // Mounted conditionally so Supabase deploys don't expose dead routes.
    composed.route(
      '/blobs',
      createBlobsRouter({
        storage: deps.storage,
        // `!` is safe: `STORAGE_PROVIDER=local-disk` conditionally-requires
        // `BLOB_SIGNING_SECRET` per env.ts's `superRefine`.
        signingSecret: deps.env.BLOB_SIGNING_SECRET!,
        maxBytes: deps.env.BLOB_MAX_BYTES,
      }),
    )
  }

  return composed
}

export type AppType = ReturnType<typeof createApp>
