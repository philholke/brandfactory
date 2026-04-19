# Phase 4 Implementation Plan — Backend skeleton (`packages/server`)

Goal: stand up the Hono HTTP + WebSocket surface in `packages/server`,
wired to the Phase 3 adapter bundle and the Phase 2 query helpers.
Result: `pnpm --filter @brandfactory/server dev` boots a process that
serves `/health`, authenticates against `AuthProvider`, round-trips
workspaces → brands → projects through Postgres, exposes workspace
settings (active LLM provider + model) for Phase 7 to write against,
accepts signed-URL blob transfers when `STORAGE_PROVIDER=local-disk`,
and upgrades `/rt` to a WebSocket that fans out `RealtimeBus` events.
No agent streaming yet (Phase 5/6), no frontend yet (Phase 7).

This plan expands
[Phase 4 of the scaffolding plan](./scaffolding-plan.md#phase-4--backend-skeleton-packagesserver)
with the design decisions made during discussion and a file-by-file task
list we can execute methodically.

---

## Locked design decisions

1. **Hono on `@hono/node-server`.** The scaffolding plan names Hono; we
   pair it with `@hono/node-server` so we keep a Node `http.Server`
   handle for the WebSocket upgrade. No Bun / Deno tooling in this
   phase — Node 20 LTS is the stated target.

2. **Boot lives in `src/main.ts`, app factory in `src/app.ts`, barrel
   stays in `src/index.ts`.** `main.ts` is the deployable entry point
   (`loadEnv` → `buildAdapters` → `createApp` → `serve` → `mountRealtime`).
   `app.ts` exports `createApp(deps)` returning a typed Hono instance so
   unit tests can drive routes without opening a socket. `index.ts`
   continues to re-export `loadEnv`, `EnvSchema`, `buildAdapters`,
   `type Env`, `type Adapters`, plus the new `createApp` and `type AppType`
   so Phase 7's `hono/client` can infer end-to-end types.

3. **End-to-end types via Hono's chain API + `hono/client`.** Every
   route module builds its routes with the chained `.get(...).post(...)`
   form so the inferred handler types survive into `typeof app`. The
   top-level app mounts children with `app.route('/foo', fooRouter)`.
   `type AppType = typeof app` is exported from `app.ts`. No tRPC, no
   OpenAPI generation in this phase.

4. **Zod validation at every boundary, schemas from `@brandfactory/shared`
   wherever one already exists.** Path params, query params, and request
   bodies are validated with `@hono/zod-validator`. New request/response
   DTOs that don't yet live in `shared` (e.g. "PATCH brand guidelines"
   body, "PATCH workspace settings" body) are added to `shared` first so
   the frontend can reuse them.

5. **Auth is `Authorization: Bearer <token>` only, verified via the
   injected `AuthProvider`.** No cookies, no session store. Middleware
   extracts the bearer token, calls `authProvider.verifyToken`, and
   writes `{ userId }` onto `c.var`. On failure: `401 { code:
   'UNAUTHORIZED' }`. The middleware does not call `getUserById` —
   hydrating the full user row is a per-route concern (only `/me` needs
   it in this phase).

6. **Authorization model in Phase 4: single-owner workspaces.** Our
   `workspaces` table already carries `owner_user_id`; Phase 4 enforces
   "you can only read/write workspaces you own" via a
   `requireWorkspaceAccess(userId, workspaceId)` helper that calls
   `getWorkspaceById` and compares. Brand/project/settings routes walk
   the ownership chain through `workspaceId`. Multi-member workspaces
   are out of scope and are called out in the not-included section.

7. **Structured logging is a 40-line inline JSON logger, not pino/winston.**
   `src/logger.ts` exports `createLogger({ level })` returning
   `{ debug, info, warn, error }` that `JSON.stringify` to stdout. A
   per-request child logger is attached to `c.var.log` by the logger
   middleware, carrying `requestId` + `userId` automatically. If we need
   shipping/rotation later, swap to pino in Phase 8 when we containerize.
   Rationale: Phase 9 is the hardening pass; adding a dependency now for
   a skeleton phase is premature.

8. **Error taxonomy deferred to Phase 9; Phase 4 ships a minimal error
   boundary.** `src/errors.ts` declares `HttpError` with `status` +
   `code` + optional `details`, and a few thin subclasses
   (`UnauthorizedError`, `ForbiddenError`, `NotFoundError`,
   `ValidationError`). A single `onError` handler maps `HttpError` →
   the right status, zod `ZodError` → 400, everything else → 500 with
   a logged stack. The Phase 9 pass replaces this with the full
   `AppError` taxonomy; the wire shape (`{ code, message, details? }`)
   is kept stable so the frontend won't re-plumb.

9. **Workspace settings persist in a new `workspace_settings` table.**
   Per the scaffolding plan's Phase 4 task list, settings land in the
   DB in this phase. Schema (singleton row per workspace): `workspace_id
   pk`, `llm_provider_id`, `llm_model`, `updated_at`. API keys stay
   env-only — DB-persisted keys need at-rest encryption, which is a
   later pass per architecture.md's pending-decisions section. The
   `GET /workspaces/:id/settings` route merges the row (if present)
   with the env defaults so a fresh workspace always returns a usable
   shape; `PATCH` writes only the provider/model.

10. **The agent uses whichever provider the workspace picked, falling
    back to env when the workspace hasn't overridden.** The settings
    row is the override; `LLM_PROVIDER` + `LLM_MODEL` env vars are the
    default. Lookup helper: `resolveLLMSettings(workspaceId, env, db) →
    { providerId, modelId }`. Phase 4 adds the helper + exposes it via
    the settings route; Phase 6 consumes it from the agent endpoint.

11. **`PATCH /brands/:id/guidelines` is an upsert-and-reorder over the
    full section list.** Body: `{ sections: Array<{ id?; label; body;
    priority }> }`. Handler delegates to `upsertSection` in a loop then
    `reorderSections`. Deleting a section is out of scope for Phase 4
    (shortlist promotion and section deletion arrive with Phase 5/6);
    partial updates are supported through `id` presence.

12. **Signed-URL blob routes are mounted only when `STORAGE_PROVIDER
    === 'local-disk'`.** Routes: `GET /blobs/:key` (signed read),
    `PUT /blobs/:key` (signed write). Both parse `exp` + `sig` from the
    query string and call `verifySignature` from
    `@brandfactory/adapter-storage` — the helper already throws
    `InvalidSignatureError` on expiry/hmac/length failures; we catch
    and return 403. `GET` streams the file via `blobStore.get` wrapped
    in `new Response(...)`. `PUT` reads the request body into a
    `Uint8Array` (simple; streaming upload is a Phase 8 polish) and
    calls `blobStore.put`. When `STORAGE_PROVIDER === 'supabase'` the
    routes are not mounted at all — Supabase Storage serves signed URLs
    directly and our server never sees those requests.

13. **WebSocket upgrade at `/rt` uses `ws.Server` with `noServer: true`,
    attached to the Node `http.Server` returned by `@hono/node-server`'s
    `serve()`.** The upgrade handler parses `Authorization` from the
    HTTP upgrade request (we accept `?token=` as a fallback query
    param because browsers can't set custom headers on `new WebSocket`,
    but only when the origin matches — enforced in Phase 7 CORS), calls
    `authProvider.verifyToken`, then hands the socket to the
    adapter's `bindToNodeWebSocketServer`. The adapter already handles
    per-client subscribe/unsubscribe framing against the shared
    `RealtimeClientMessageSchema`. All of this lives in `src/ws.ts`;
    `main.ts` just calls `mountRealtime(httpServer, adapters, log)`.

14. **Channel-naming convention: `project:<projectId>`, `brand:<brandId>`,
    `workspace:<workspaceId>`.** Authorization callback inside
    `bindToNodeWebSocketServer` decodes the channel, walks the aggregate
    back to a workspace id, and reuses `requireWorkspaceAccess`. Phase 4
    only subscribes; publishing through `/rt` from clients is not a
    thing — the server publishes in response to HTTP writes in later
    phases.

15. **Dev loop is `tsx watch src/main.ts`; build is deferred to Phase 8.**
    `packages/server/package.json` gains a `dev` script wrapping tsx.
    No bundler, no emit-to-`dist`. The Dockerfile will decide between
    `tsx` at runtime or an esbuild step when Phase 8 containerizes.

16. **Vitest coverage target for Phase 4: middleware + every route's
    happy path + at least one error path per route.** Route tests use
    `app.request(new Request(...))` against `createApp({...})` with
    fake adapters — no live HTTP, no real WS. The realtime authorize
    callback gets its own unit test against a fake `ws.Server`. End-to-end
    tests across a booted process live in Phase 9 (Playwright).

---

## Prerequisites

### Shared additions — `packages/shared`

- [ ] `src/workspace/settings.ts`:
  - `WorkspaceSettingsSchema` — `{ workspaceId: WorkspaceId, llmProviderId: LLMProviderId, llmModel: string, updatedAt: string }`.
  - `type WorkspaceSettings`.
  - `UpdateWorkspaceSettingsInputSchema` — `{ llmProviderId: LLMProviderId, llmModel: string }` (no `workspaceId` — that's a path param).
  - `type UpdateWorkspaceSettingsInput`.
  - **Note:** `LLMProviderId` is currently a string literal union re-declared here (or re-imported from `@brandfactory/adapter-llm`?). Since `shared` is client-importable and adapters are server-only, we duplicate the string union here and pin a `satisfies` check in the server to keep them in sync. This mirrors the Phase 3 `LLM_PROVIDER_IDS as const satisfies readonly LLMProviderId[]` pattern.
- [ ] `src/brand/update-guidelines.ts`:
  - `UpdateBrandGuidelinesInputSchema` — `{ sections: Array<{ id?: SectionId, label: string, body: ProseMirrorDoc, priority: number }> }`.
  - `type UpdateBrandGuidelinesInput`.
- [ ] `src/workspace/create.ts` + `src/brand/create.ts` + `src/project/create.ts`:
  - Create-input schemas that pick the handful of fields the POST routes accept (e.g. `CreateWorkspaceInputSchema = z.object({ name: z.string().min(1) })`). Today these are typed via `@brandfactory/db`'s query-helper input types but those include branded `UserId`/`WorkspaceId` which the HTTP client can't produce — the route is responsible for injecting `ownerUserId` from auth.
- [ ] `src/index.ts`: barrel re-exports for all of the above.
- [ ] Verify: `pnpm --filter @brandfactory/shared typecheck` + repo-wide `lint` + `format:check`.

### DB additions — `packages/db`

- [ ] `src/schema/workspace-settings.ts`:
  - Drizzle table `workspace_settings` with columns `workspace_id uuid pk references workspaces.id on delete cascade`, `llm_provider_id text not null`, `llm_model text not null`, `updated_at timestamptz default now() not null`.
- [ ] `src/schema/index.ts`: re-export.
- [ ] `src/queries/workspace-settings.ts`:
  - `getWorkspaceSettings(workspaceId): Promise<WorkspaceSettings | null>` — returns null if no row yet.
  - `upsertWorkspaceSettings(input: { workspaceId, llmProviderId, llmModel }): Promise<WorkspaceSettings>` — `ON CONFLICT (workspace_id) DO UPDATE`.
- [ ] `src/index.ts`: barrel re-export.
- [ ] `pnpm --filter @brandfactory/db db:generate` — commit the SQL migration alongside the schema file.
- [ ] Add a line to the smoke check (`packages/db/scripts/smoke.ts`) exercising the new helpers so CI catches regressions.

---

## Implementation tasks

### 1. Server dependencies + scripts

- [ ] `packages/server/package.json`:
  - runtime deps: `hono`, `@hono/node-server`, `@hono/zod-validator`,
    `ws`, `@brandfactory/db` (new — Phase 3 didn't need it).
    `@brandfactory/shared`, `zod`, `dotenv`, the four adapters are
    already present.
  - dev deps: `@types/ws` (already in `adapter-realtime`'s devDeps,
    add here too), `vitest` already present.
  - scripts: `dev` → `tsx watch src/main.ts`; `start` → `tsx src/main.ts`
    (Phase 8 replaces with a compiled node entry).
- [ ] Root `scripts/dev.sh`: optional nicety — pick up the new
  `@brandfactory/server dev` so `pnpm dev` boots the server alongside
  the placeholder text for `web`.

### 2. Hono context + logger + middleware

- [ ] `packages/server/src/context.ts`:
  - Declare `type ServerBindings = {}` and `type ServerVariables = {
    requestId: string; log: Logger; userId?: string }`.
  - Export a `ServerHono` alias:
    `type ServerHono = Hono<{ Bindings: ServerBindings; Variables: ServerVariables }>`.
  - All route modules type their `new Hono<...>` against this alias so
    `c.var.log` / `c.var.userId` resolve everywhere.

- [ ] `packages/server/src/logger.ts`:
  - `type Logger = { debug; info; warn; error }` each `(msg: string, fields?: Record<string, unknown>) => void`.
  - `createLogger({ level }): Logger` that `JSON.stringify`s `{ ts, level, msg, ...fields }` to stdout at or above the configured level.
  - `logger.child(fields): Logger` returning a logger that merges the
    extra fields into every emission.

- [ ] `packages/server/src/middleware/request-id.ts`:
  - Pulls `x-request-id` from the incoming headers or generates one via
    `crypto.randomUUID()`. Sets `c.var.requestId` and echoes the header
    on the response.

- [ ] `packages/server/src/middleware/logger.ts`:
  - Builds a child logger off the root with `{ requestId: c.var.requestId }`.
    Logs `{ method, path, status, durationMs }` after each request.
    Attaches the child to `c.var.log`.

- [ ] `packages/server/src/middleware/auth.ts`:
  - `createAuthMiddleware(auth: AuthProvider)`: reads `Authorization: Bearer <token>`, calls `auth.verifyToken`, sets `c.var.userId`.
  - On missing/invalid → throws `UnauthorizedError` (caught by the
    error boundary, returned as 401).
  - A separate `optionalAuth` middleware exists for `/health` (still
    sets `userId` when present, doesn't throw on absence). `/health` is
    the only unauthenticated route in Phase 4.

- [ ] `packages/server/src/middleware/error.ts`:
  - Exports `onError(err, c)`. Checks `err instanceof HttpError` → status/code/details JSON. `err instanceof ZodError` → 400 with field errors. Everything else → logs the stack, returns `{ code: 'INTERNAL', message: 'Internal Server Error' }` at 500.
  - Always emits a JSON body; never returns HTML error pages.

- [ ] `packages/server/src/errors.ts`:
  - `class HttpError extends Error { constructor(status, code, message, details?) }`.
  - `UnauthorizedError` (401/UNAUTHORIZED), `ForbiddenError` (403/FORBIDDEN), `NotFoundError` (404/NOT_FOUND), `ValidationError` (400/VALIDATION — reserved; the zod validator throws `ZodError` directly, this is for business rules).

### 3. Authorization helper

- [ ] `packages/server/src/authz.ts`:
  - `requireWorkspaceAccess(userId, workspaceId, deps: { db })` — loads workspace, throws `NotFoundError` if absent, `ForbiddenError` if `ownerUserId !== userId`. Returns the workspace on success so callers can avoid re-loading.
  - `requireBrandAccess(userId, brandId, deps: { db })` — loads brand → delegates to `requireWorkspaceAccess(userId, brand.workspaceId)`.
  - `requireProjectAccess(userId, projectId, deps: { db })` — same walk via brand → workspace.
  - Unit tests cover each: owner passes, non-owner forbidden, missing aggregate → 404.

### 4. Routes

Each route module exports `createXxxRouter(deps)` returning a
`ServerHono`. Deps passed in: `{ db, auth, storage, realtime, llm, env, log }`.

- [ ] `src/routes/health.ts` — `GET /health` → `{ status: 'ok', version: pkg.version }`. No auth, no DB.

- [ ] `src/routes/me.ts` — `GET /me`. Auth required. Calls `auth.getUserById(c.var.userId)`; if null → 404 with `USER_NOT_FOUND`. Returns the `User` row shape.

- [ ] `src/routes/workspaces.ts`:
  - `GET /workspaces` → `listWorkspacesByOwner(c.var.userId)`.
  - `POST /workspaces` → body `CreateWorkspaceInputSchema` → `createWorkspace({ name, ownerUserId: c.var.userId })`.
  - `GET /workspaces/:id` → `requireWorkspaceAccess` → return the row.

- [ ] `src/routes/brands.ts`:
  - `GET /workspaces/:workspaceId/brands` → `requireWorkspaceAccess` → `listBrandsByWorkspace`.
  - `POST /workspaces/:workspaceId/brands` → body `CreateBrandInputSchema` → `createBrand({ workspaceId, name, description })`.
  - `GET /brands/:id` → `requireBrandAccess` → compose `{ ...brand, sections: listSectionsByBrand(id) }` → returns `BrandWithSections`.
  - `PATCH /brands/:id/guidelines` → `requireBrandAccess` → body `UpdateBrandGuidelinesInputSchema` → for each `{ id?, label, body, priority }` call `upsertSection`, then `reorderSections` with the final priority list → return the hydrated sections.

- [ ] `src/routes/projects.ts`:
  - `GET /brands/:brandId/projects` → `requireBrandAccess` → `listProjectsByBrand`.
  - `POST /brands/:brandId/projects` → body `CreateProjectInputSchema` (discriminated on `kind`) → `createProject`.
  - `GET /projects/:id` → `requireProjectAccess` → `{ ...project, canvas: getCanvasByProject(project.id) }` (canvas is 1:1 with project; returning it here saves a round-trip in Phase 7).

- [ ] `src/routes/settings.ts`:
  - `GET /workspaces/:id/settings` → `requireWorkspaceAccess` → `getWorkspaceSettings(id)` OR env defaults → `{ llmProviderId, llmModel, source: 'workspace' | 'env' }`.
  - `PATCH /workspaces/:id/settings` → `requireWorkspaceAccess` → body `UpdateWorkspaceSettingsInputSchema` → `upsertWorkspaceSettings(...)` → returns the merged shape.

- [ ] `src/routes/blobs.ts` (only mounted when `env.STORAGE_PROVIDER === 'local-disk'`):
  - `GET /blobs/:key` — reads `exp` + `sig` from query string, calls `verifySignature({ method: 'GET', key, exp: Number(exp), sig, signingSecret: env.BLOB_SIGNING_SECRET })`. On success → `blobStore.get(key)` → `new Response(body, { headers: { 'content-type': '...' } })`. Content-type inference is a nice-to-have; for Phase 4, leave it `application/octet-stream` and let the upload PUT set an `X-Content-Type` header we persist alongside in Phase 8 (no persistence of content-type in this phase — added when the frontend actually uploads images).
  - `PUT /blobs/:key` — same signature check with `method: 'PUT'`, reads body via `await c.req.arrayBuffer()` → `new Uint8Array(ab)` → `blobStore.put(key, bytes, { contentType })`. Returns `{ key }`.
  - Rationale for mounting conditionally: calling these against a Supabase deploy would just 404 anyway; hiding them at wiring time keeps the route surface honest and means `GET /routes.json` (if we ever add one) doesn't lie.

- [ ] `src/app.ts`:
  - `createApp(deps): ServerHono` composes every route and every middleware in order. Returns the typed Hono instance.
  - Order: request-id → logger → (per-route) auth → validators → handler → onError.
  - Mounts: `/` (health), `/` (auth-guarded router containing every other route), conditionally `/` (blobs).
  - Exports `type AppType = ReturnType<typeof createApp>` for `hono/client` in Phase 7.

### 5. WebSocket realtime mount

- [ ] `packages/server/src/ws.ts`:
  - `mountRealtime({ httpServer, realtime, auth, db, log })`:
    - `const wss = new WebSocketServer({ noServer: true })`.
    - `httpServer.on('upgrade', (req, socket, head) => { if (url.pathname !== '/rt') return socket.destroy(); wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)); })`.
    - Calls `realtime.bindToNodeWebSocketServer(wss, { authenticate, authorize })`.
    - `authenticate(req)`: reads token from `Authorization` header or `?token=` query. Calls `auth.verifyToken`. Returns `userId` or `null` (adapter closes socket with 4401 on null).
    - `authorize({ userId, channel })`: parses the channel prefix (`project:` / `brand:` / `workspace:`), resolves back to a workspace, calls `requireWorkspaceAccess` (soft — returns false rather than throwing so the adapter closes the subscription cleanly).
  - Unit tests: mock `ws.Server`, drive `connection` + `subscribe` messages, assert `authorize` gatekeeping.

### 6. Main entry

- [ ] `packages/server/src/main.ts`:
  - `const env = loadEnv()`.
  - `const log = createLogger({ level: env.LOG_LEVEL ?? 'info' })` (add `LOG_LEVEL` as an optional env var with default `'info'`).
  - `const db = createDb(env.DATABASE_URL)` — **note:** today `@brandfactory/db` exports a singleton `db`/`pool` that reads `DATABASE_URL` at import time. Phase 4 needs either (a) to keep the singleton and just import it, or (b) convert to a factory. Leaning toward (a) for Phase 4 since Phase 2 already shipped singletons; revisit if tests need per-case pools.
  - `const adapters = buildAdapters(env)`.
  - `const app = createApp({ db, ...adapters, env, log })`.
  - `const httpServer = serve({ fetch: app.fetch, port: env.PORT ?? 3001, hostname: env.HOST ?? '0.0.0.0' }, info => log.info('listening', info))`.
  - `mountRealtime({ httpServer, realtime: adapters.realtime, auth: adapters.auth, db, log })`.
  - Graceful shutdown: `SIGTERM` / `SIGINT` → close WS server → close HTTP server → `pool.end()` → exit.

- [ ] `packages/server/src/env.ts` (extension): add `PORT` (number, default 3001), `HOST` (default `'0.0.0.0'`), `LOG_LEVEL` (enum `'debug' | 'info' | 'warn' | 'error'`, default `'info'`) to `EnvSchema`. No `superRefine` changes needed.

### 7. Tests

- [ ] `src/middleware/auth.test.ts` — valid bearer, missing header, invalid token.
- [ ] `src/middleware/error.test.ts` — `HttpError` → right status, `ZodError` → 400, unknown → 500 with log.
- [ ] `src/authz.test.ts` — owner passes, non-owner forbidden, missing aggregate → 404. One test per helper.
- [ ] `src/routes/health.test.ts` — `app.request('/health')` → 200 `{ status: 'ok' }`.
- [ ] `src/routes/me.test.ts` — happy path with stub auth; 404 when `getUserById` returns null.
- [ ] `src/routes/workspaces.test.ts` — list-mine, create-mine, get-mine, forbidden-on-others. Uses a fake `db` object satisfying the narrow slice of the query-helper surface we actually call (not the real singleton).
- [ ] `src/routes/brands.test.ts` — list, create, get (hydrated with sections), PATCH guidelines (upsert + reorder).
- [ ] `src/routes/projects.test.ts` — list, create freeform, create standardized, get (hydrated with canvas).
- [ ] `src/routes/settings.test.ts` — env fallback when no row, workspace row overrides env after PATCH.
- [ ] `src/routes/blobs.test.ts` — signed GET happy path, signed PUT happy path, expired sig → 403, tampered sig → 403, missing sig params → 400.
- [ ] `src/ws.test.ts` — authenticate returns userId on valid token; rejects on invalid; authorize passes for owner's project channel and fails for others.

DB-backed tests (anything that needs a real pool) guard with `it.skipIf(!process.env.DATABASE_URL)`, consistent with Phase 3.

### 8. `.env.example` updates

- [ ] Append:
  - `PORT=3001`
  - `HOST=0.0.0.0`
  - `LOG_LEVEL=info`
- [ ] Add a header comment noting that the blob routes are only mounted when `STORAGE_PROVIDER=local-disk`.

### 9. Smoke check

Phase 4's smoke is the one the scaffolding plan prescribes:

- [ ] `pnpm --filter @brandfactory/server dev` boots without errors.
- [ ] `curl localhost:3001/health` → `{ "status": "ok", "version": "..." }`.
- [ ] `curl -H 'Authorization: Bearer <dev-user-uuid>' localhost:3001/me` → the dev user row. (Create a user first via the db smoke script or a one-liner.)
- [ ] `curl -X POST ... /workspaces` with `{ "name": "Acme" }` → workspace row.
- [ ] `curl -X POST ... /workspaces/:id/brands` with `{ "name": "Acme Main" }` → brand row.
- [ ] `curl -X POST ... /brands/:id/projects` with `{ "kind": "freeform", "name": "Naming" }` → project row.
- [ ] `curl .../projects/:id` → project with `canvas` payload nested.
- [ ] `curl -X PATCH .../workspaces/:id/settings` with `{ "llmProviderId": "anthropic", "llmModel": "claude-sonnet-4.6" }` → merged settings row. `curl .../workspaces/:id/settings` reflects the new values with `source: 'workspace'`.
- [ ] With `STORAGE_PROVIDER=local-disk`: mint a signed PUT URL via a one-liner (`import { createLocalDiskBlobStore } ...`), `curl -X PUT <url> --data-binary @file`, then `curl <signed-get-url>` returns the bytes.
- [ ] Open a WS client against `ws://localhost:3001/rt?token=<dev-uuid>`, send `{ "type": "subscribe", "channel": "project:<id>" }`, publish via a scratch script that calls `adapters.realtime.publish('project:<id>', ...)`, confirm the client receives the envelope.
- [ ] Repo-wide `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` all green.

---

## What Phase 4 explicitly does NOT include

- **Agent streaming endpoint (`POST /projects/:id/agent`).** Phase 6, consuming Phase 5's `@brandfactory/agent` package.
- **Canvas mutation routes** (`POST /projects/:id/canvas/blocks`, pin/unpin, etc.). Phase 6/7 — these ride the agent tool-call path and the frontend's direct-write path, both of which need the agent package first.
- **API-key persistence** on workspace settings. Needs at-rest encryption; deferred per architecture.md.
- **Multi-member workspaces / invitations / roles.** Single-owner only in Phase 4. The scaffolding plan calls out that org-level permissions beyond "user belongs to workspace" are explicitly not in scope.
- **Section deletion** from `PATCH /brands/:id/guidelines`. Phase 5/6 when shortlist promotion lands.
- **`hono/client` consumer.** `type AppType` is exported so Phase 7 can wire it up; the web package doesn't exist yet.
- **CORS / rate limiting / CSRF.** Phase 7 (when the frontend lands and we know the origin) + Phase 9.
- **OpenAPI / OpenRPC spec emission.** Not on the roadmap; the `hono/client` route inference replaces it.
- **Production build / Dockerfile.** Phase 8.
- **Blob content-type persistence** (the PUT route hand-wave in task 4). Phase 8 when image drops land in the frontend.

---

## Open questions

These are genuinely unresolved; flag in the next working session before
starting on the section they affect.

- **`@brandfactory/db` singleton vs factory.** The Phase 2 package opens a `Pool` at import time off `DATABASE_URL`. That was fine for the smoke script; Phase 4 needs to (a) live with it and import directly in `main.ts`, or (b) convert `db`/`pool` to factories so tests can inject an isolated pool. Leaning (a) for Phase 4, file an issue for (b) if the test pain shows up.
- **Channel-authorization aggressiveness.** Current decision 14 says channel prefix determines the workspace walk. Do we also need to reject channels the server has never published to, i.e. require the aggregate to exist? Lean no — empty subscriptions are harmless, and the HTTP path is the real gate.
- **Settings fallback shape.** Decision 9 returns `source: 'workspace' | 'env'`. Alternative: always return a plain `WorkspaceSettings` and expose whether it's persisted via a separate `GET .../settings/source` or an ETag. Lean toward the inline `source` field — cheap, explicit, easy for the Phase 7 settings page to render.

---

## Phase 4 completion record

On completion, document actuals in `docs/completions/phase4.md` and
per-task records (`phase4-task1.md` through `phase4-task9.md`) in the
same style as Phase 2/3. Capture:

- Locked decisions as delivered (or where we diverged and why).
- How each open question landed.
- Notable Hono / `@hono/node-server` / `ws` API surprises, especially
  around the HTTP-upgrade dance.
- The unit-test output and the manual smoke transcript.

Archive this file to `docs/archive/phase-4-server.md` once the record is
written.
