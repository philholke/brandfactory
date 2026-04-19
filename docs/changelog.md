# Changelog

Latest releases at the top. Each version has a one-line entry in the index
below, with full detail further down.

## Index

- **0.4.0** — 2026-04-19 — Phase 3: four `@brandfactory/adapter-*` packages land with ports + default impls, `@brandfactory/server` gains `loadEnv()` + `buildAdapters()`, vitest stands up across the repo with 31 unit tests green.
- **0.3.0** — 2026-04-18 — Phase 2: `@brandfactory/db` lands — drizzle schema for 8 tables, singleton pg `Pool`, 18 query helpers, local-dev docker Postgres, and an end-to-end smoke check.
- **0.2.0** — 2026-04-18 — Phase 1: `@brandfactory/shared` lands as the single source of truth for domain types and zod schemas, consumed by both `server` and `web`.
- **0.1.0** — 2026-04-18 — Project bootstrap: vision, architecture blueprint, scaffolding plan, and Phase 0 repo foundation.

---

## 0.4.0 — 2026-04-19

First swappable port-and-adapter layer in the repo. Four
`@brandfactory/adapter-*` packages each export a port type plus the
default impls that satisfy it. `@brandfactory/server` reads a single
zod-validated env at boot and assembles the four adapters into a typed
bundle — no vendor name leaks past the adapter boundary. Realtime,
storage, and auth all surface dependency-injection seams so Phase 3 ships
the first real unit-test layer alongside the code (vitest, projects
mode, 31 tests across 8 files).

### Phase 3 execution plan — `docs/executing/phase-3-adapters.md`

- Expanded Phase 3 of the scaffolding plan into a file-by-file task
  list across nine tasks (shared envelope prerequisite, four adapter
  packages, server env loader + `buildAdapters`, root vitest setup,
  `.env.example`, smoke check).
- Locked fifteen design decisions up front: ports live in their adapter
  package (no new `core` workspace), `buildAdapters(env)` lives in
  `packages/server`, env validation lives in `packages/server/src/env.ts`
  and adapters never read `process.env` themselves, the LLM port returns
  an AI-SDK `LanguageModel` (no extra abstraction), the realtime port is
  pub/sub only with HTTP/WS upgrade deferred to Phase 4, the storage port
  surfaces signed URLs for both reads and writes (HMAC-SHA256 over
  `(method, key, exp)` for `local-disk`), `AuthProvider` collapses to
  `verifyToken` + `getUserById` only (`listUsers` dropped — DB territory,
  not identity-provider territory), settings are env-only in Phase 3,
  vitest is the project test runner, the WS framing schema lives in
  `@brandfactory/shared` (so `web` can speak the same protocol),
  per-provider config is discrete env vars validated with `superRefine`,
  vitest runs in projects mode with one root config + per-package configs,
  and deferred adapter impls are absent from code rather than throw-stubs
  (the `*_PROVIDER` enum narrows to shipped impls so a misconfigured env
  fails loudly at boot).
- Archived to `docs/archive/phase-3-adapters.md` on completion.

### Prerequisite shared addition — `packages/shared/src/realtime/envelope.ts`

Per locked decision 12, the WS framing schema lives in shared so both
`web` and `server` can validate the same protocol — adapter packages are
server-only and `web` cannot import from them.

- `RealtimeChannelSchema = z.string().min(1)` (intentionally loose for
  Phase 3; tighter naming convention lands when the server picks one).
- `RealtimeEventPayloadSchema = z.union([AgentEventSchema,
  CanvasOpEventSchema, PinOpEventSchema])`.
- `RealtimeClientMessageSchema` — browser → server: `subscribe |
  unsubscribe`, discriminated on `type`.
- `RealtimeServerMessageSchema` — server → browser: `event` (kept as a
  single-branch discriminated union so adding `error`/`ack` later is
  mechanical).
- Inferred types exported alongside; barrel re-export in
  `packages/shared/src/index.ts`.

### Phase 3 implementation — four adapter packages

Each adapter follows the same shape: `port.ts` declares the interface
and any error classes, one file per impl exports a factory function
(`createXxx(config, deps?)`) returning a plain object satisfying the
port, `index.ts` is a barrel that opens with a header comment listing
shipped *and* planned-but-not-yet-shipped impls so future intent
survives without runtime stubs.

- **`@brandfactory/adapter-auth`** —
  - Port: `verifyToken(token) → { userId }` + `getUserById(id) → User
    | null`. `User` is re-exported from `@brandfactory/db` so callers
    get one canonical row type. `InvalidTokenError` for any rejection.
  - `local`: dev-only, the bearer token IS the user id (uuid-validated
    via regex, then looked up via `@brandfactory/db.getUserById`).
    Token-as-id collapses crypto-free local dev into a single line of
    setup; production callers wire a real provider instead.
  - `supabase`: `jose.createRemoteJWKSet` + `jose.jwtVerify` against
    the project JWKS. `audience` and `issuer` optional. The `sub`
    claim becomes `userId`. A `jwks` test seam lets unit tests pass
    an in-memory key set instead of fetching one. Phase 3 does not
    sync Supabase Auth's `auth.users` back into our `users` table.

- **`@brandfactory/adapter-storage`** —
  - Port: `BlobStore` with `put | get | delete | getSignedReadUrl |
    getSignedWriteUrl`. Bodies accepted as `Uint8Array` or Node
    readable streams. `BlobNotFoundError` and `InvalidSignatureError`
    exposed.
  - `local-disk`: filesystem under `rootDir` with `mkdir -p` on each
    `put`. Path-traversal defense via `path.resolve` + a startsWith
    check against the resolved root (`../escape.bin` throws before any
    I/O). Signed URLs are HMAC-SHA256 over `${method}\n${key}\n${exp}`,
    hex-encoded, with a 15-minute default TTL. URL shape:
    `${publicBaseUrl}/${encodeURI(key)}?exp=<unix>&sig=<hex>`. A
    `verifySignature({ method, key, exp, sig, signingSecret, now? })`
    helper is exported for the Phase 4 server route — does an expiry
    check, recomputes the HMAC, and compares with
    `crypto.timingSafeEqual`. Constant-time + length-checked.
  - `supabase`: thin wrapper over `client.storage.from(bucket)`'s
    `upload | download | remove | createSignedUrl |
    createSignedUploadUrl`. A `client` dep injection seam keeps unit
    tests off the real `@supabase/supabase-js` fetch path.

- **`@brandfactory/adapter-realtime`** —
  - Port: `RealtimeBus` with `publish(channel, event) → Promise<void>`
    + `subscribe(channel, handler) → unsubscribe`. Event type imported
    from `@brandfactory/shared` (`AgentEvent | CanvasOpEvent |
    PinOpEvent`).
  - `native-ws`: in-process `Map<channel, Set<handler>>`. Empty sets
    are collected on unsubscribe. Handler exceptions are swallowed so
    one bad subscriber can't break fan-out (will surface via a logger
    in Phase 4).
  - `bindToNodeWebSocketServer(wss, { authenticate, authorize? })`
    wires a `ws.Server`'s `connection` event to per-client
    subscribe/unsubscribe handling. Failed `authenticate` →
    `socket.close(4401, 'unauthorized')`. Inbound frames are validated
    against `RealtimeClientMessageSchema` from shared. Outbound frames
    are typed as `RealtimeServerMessage`. Adapter does not own the
    HTTP upgrade — that lives in `packages/server` (Phase 4).

- **`@brandfactory/adapter-llm`** —
  - Port: `LLMProvider.getModel({ providerId, modelId }) →
    LanguageModel`, `LLMProviderId = 'openrouter' | 'anthropic' |
    'openai' | 'ollama'`, `LLMProviderConfig` (per-provider config
    blocks), `ProviderNotConfiguredError`. `LanguageModel` is `import
    type` from `ai` — no intermediate abstraction since Phase 5's
    `agent` package will consume AI-SDK directly.
  - `createLLMProvider(config, deps?)`: per-provider AI-SDK clients
    are constructed eagerly via `createAnthropic` / `createOpenAI` /
    `createOpenRouter` / `createOllama` and cached in a
    `Map<LLMProviderId, ProviderFactory>` so a long-running server
    doesn't rebuild on every `getModel` call. Exhaustiveness on
    `providerId` enforced by a `_exhaustive: never` default branch.
    API-key providers throw `ProviderNotConfiguredError` if the
    matching config block is missing; `ollama` is always callable
    (defaults to a local daemon, no key needed). Each `buildXxx` is a
    test seam — unit tests pass `vi.fn()` factories and never load
    the real SDK paths.

### Server env loader + `buildAdapters` — `packages/server`

- **`src/env.ts`** — one `EnvSchema = z.object({…}).superRefine(…)`.
  Required base fields: `DATABASE_URL`, the four `*_PROVIDER`
  selectors, `LLM_MODEL`. Optional per-provider fields are
  `.optional()` and promoted to required by `superRefine` based on
  which providers are active:
  - `AUTH_PROVIDER='supabase'` → `SUPABASE_JWKS_URL` required.
  - `STORAGE_PROVIDER='local-disk'` → `BLOB_LOCAL_DISK_ROOT` +
    `BLOB_SIGNING_SECRET` + `BLOB_PUBLIC_BASE_URL` required.
  - `STORAGE_PROVIDER='supabase'` → `SUPABASE_URL` +
    `SUPABASE_SERVICE_KEY` + `SUPABASE_STORAGE_BUCKET` required.
  - `LLM_PROVIDER='anthropic'|'openai'|'openrouter'` → matching
    `*_API_KEY` required. `LLM_PROVIDER='ollama'` requires nothing.
  - `LLM_PROVIDER_IDS` declared `as const satisfies readonly
    LLMProviderId[]` so a future enum widening in `adapter-llm` won't
    silently drift from this schema — TS fails the satisfies check.
  - `loadEnv(source = process.env)` returns the parsed `Env` or throws
    with a multi-line `path: message` summary of every issue.
- **`src/adapters.ts`** — `buildAdapters(env): { auth, storage,
  realtime, llm }` switches on each `*_PROVIDER` and calls the
  matching factory with the right env slice. Realtime is currently
  unconditional (only `native-ws` ships in Phase 3); adding a second
  impl widens the enum *and* the switch in lockstep, with the
  compiler enforcing exhaustiveness.

### Vitest setup — root + per-package projects mode

- Root `vitest.config.ts` declares `test.projects` pointing at the
  five tested workspaces (`adapters/{auth,storage,realtime,llm}` +
  `server`).
- Each project ships its own `vitest.config.ts` using `defineProject`
  with a `name` (so the runner labels output per package),
  `include: src/**/*.test.ts`, `environment: 'node'`. Per-package
  `pnpm --filter <pkg> test` continues to work, and so does the root
  `pnpm test`.
- `vitest@^2.1.8` added as a root devDep; root `test` script is now
  `vitest run` instead of the old `pnpm -r --parallel test`.

### `.env.example` — extended

Adapter selection (`AUTH_PROVIDER`, `STORAGE_PROVIDER`,
`REALTIME_PROVIDER`, `LLM_PROVIDER`, `LLM_MODEL`), the local-disk
trio (`BLOB_LOCAL_DISK_ROOT`, `BLOB_SIGNING_SECRET`,
`BLOB_PUBLIC_BASE_URL`), the Supabase set (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWKS_URL`,
`SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER`,
`SUPABASE_STORAGE_BUCKET`), and the LLM keys (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`,
`OLLAMA_BASE_URL`). Header comment explains that `*_PROVIDER` picks
which adapter the server wires up at boot.

### Smoke check — unit tests across the adapter layer

Per the scaffolding plan, Phase 3's smoke is **unit tests per
adapter**, not an end-to-end. Test counts (all green):

- `adapter-auth/local.test.ts` — 4 tests: uuid happy path, non-uuid
  rejection, missing-user rejection, getUserById delegation. Uses an
  injected `getUserById` so no DB is touched.
- `adapter-auth/supabase.test.ts` — 3 tests: mints RS256 keys via
  `jose.generateKeyPair`, verifies a valid token decodes to the right
  `sub`, expired tokens reject, no-`sub` tokens reject. JWKS provided
  via the test seam — no real Supabase or network.
- `adapter-storage/local-disk.test.ts` — 6 tests: round-trips
  put/get/delete in a `mkdtemp` root, asserts traversal rejection,
  signs/verifies a read URL, rejects expired and tampered sigs,
  asserts a PUT-signed URL doesn't verify as GET.
- `adapter-storage/supabase.test.ts` — 2 tests: hand-rolled fake
  client verifies the adapter calls the right SDK methods with the
  right args, including content-type passing on writes.
- `adapter-realtime/native-ws.test.ts` — 4 tests: spins up a real
  `http.Server` + `ws.Server` on an ephemeral port and verifies
  in-process publish/subscribe + idempotent unsubscribe, fan-out to
  two real WS clients on the same channel, over-the-wire unsubscribe
  stops further delivery, and `authenticate() → null` closes the
  socket with code `4401`.
- `adapter-llm/factory.test.ts` — 5 tests: caching (one
  `buildAnthropic` call across two `getModel` calls), modelId
  passing, openrouter `baseURL` plumbing, ollama-with-no-config, and
  the `ProviderNotConfiguredError` path.
- `server/env.test.ts` — 6 tests: local happy path, supabase happy
  path, and four conditional-required failure paths
  (`SUPABASE_JWKS_URL`, `BLOB_SIGNING_SECRET`, `ANTHROPIC_API_KEY`,
  ollama-with-no-key).
- `server/adapters.test.ts` — 1 test: `loadEnv` + `buildAdapters` for
  the local + native-ws + openrouter combo, asserts the returned
  bundle has the four expected method shapes.

### Cross-cutting changes outside the adapter packages

- **`packages/shared`** — new `src/realtime/envelope.ts` + barrel
  re-export. No other shared changes.
- **`packages/db/src/client.ts`** — `pool` and `db` are now lazy
  `Proxy`-wrapped singletons. The `DATABASE_URL` check moved from
  module-import time to first-access time. Required because vitest
  setup files run *after* module evaluation, so import-time `throw`s
  cannot be neutralized by a sentinel value. Real callers see
  identical behavior (still throws on first query if env isn't set);
  test-time imports for type-only consumers no longer fail.
- **Root `package.json`** — `vitest@^2.1.8` added to devDeps; root
  `test` script now runs `vitest run` instead of the old
  `pnpm -r --parallel test` recursion.
- **Root `vitest.config.ts`** — new file, declares projects mode.

### Architecture doc updates owed

Per locked decision 10, `docs/architecture.md` originally sketched
`AuthProvider` with `listUsers`. The Phase 3 port drops that method —
listing users is `@brandfactory/db` territory, not an identity
concern. Update needed: amend the AuthProvider port sketch in
`docs/architecture.md` and link to the Phase 3 completion record.

### API notes worth remembering

- **Zod 4 vs AI-SDK peer:** the AI-SDK provider modules declare a
  peer dependency on `zod@^3.x`; this repo runs `zod@^4.3`. pnpm
  warns; the `LanguageModel` type we re-export is a plain TS
  interface and isn't zod-derived, so the version skew is harmless
  in our usage. If we ever consume a zod schema *exported* by an
  AI-SDK module, revisit.
- **`ws@8` `connection` handler:** delivers `(socket, req:
  IncomingMessage)`; we read the request from the second arg for
  `authenticate`. Header-based auth (e.g.
  `Sec-WebSocket-Protocol: bearer.<token>`) belongs in the
  user-supplied `authenticate` callback, not in the bus.
- **HMAC URL format choice:** `${method}\n${key}\n${exp}` was picked
  because newlines aren't valid in any of the inputs and the format
  is trivially debuggable (`echo -ne "GET\nfoo\n123" | openssl dgst
  -sha256 -hmac secret`). Verifier and signer share a single
  source-of-truth function.
- **`jose.generateKeyPair('RS256')`** returns `KeyLike`
  (`CryptoKey | KeyObject`); the supabase auth test signs with
  `KeyLike` rather than `CryptoKey` to avoid pulling the DOM lib
  into our node-only tsconfig.
- **Vitest projects mode requires per-package configs.** Vitest 2
  needs a `vitest.config.ts` at each project root (or an inline
  config). Per-package configs also let `web` later pick
  `environment: 'jsdom'` without polluting the rest.

### Phase 3 completion record — `docs/completions/phase3.md`

Phase-level wrap with per-task notes inline (Phase 3's surface area
was tighter than Phase 2; one document is enough). Captures the
fifteen locked design decisions delivered as specified, every
adapter's port + impl + test detail, the cross-cutting changes
outside the adapter packages (shared envelope, db client lazy
singleton, root vitest config, root `package.json` test script), the
architecture-doc TODO around `listUsers`, and the API quirks worth
remembering. Also documents what Phase 3 explicitly did *not* include
(HTTP server / routes / middleware / WS upgrade endpoint / blob HTTP
routes / workspace-level LLM settings / agent prompt assembly /
Supabase Auth ↔ users sync / API-key encryption at rest / e2e — all
per the plan's exclusion list).

### Verification

All green on a fresh install:

```
pnpm install       ✔
pnpm test          ✔  8 files, 31 tests pass
pnpm typecheck     ✔  9/9 workspaces pass
pnpm lint          ✔  0 problems
pnpm format:check  ✔  all files clean
```

The Phase 2 `db smoke` script was not re-run in this session because
Docker wasn't available locally. The `client.ts` lazy-singleton
refactor preserves the runtime contract (still throws on first DB
access if `DATABASE_URL` is unset); the Phase 3 unit tests exercise
the import-without-DB paths that previously broke.

---

## 0.3.0 — 2026-04-18

First database layer in the repo. `@brandfactory/db` is the typed,
migration-driven Postgres package every backend concern will build
against: drizzle-orm over `pg`, schema mirrors `@brandfactory/shared`,
ids are real `uuid` columns while shared keeps its branded-string types
at the type layer. A one-shot smoke script walks a real user →
workspace → brand → project → canvas → block → event flow end-to-end
against a docker-compose Postgres.

### Phase 2 execution plan — `docs/executing/phase-2-database-package.md`

- Expanded Phase 2 of the scaffolding plan into a file-by-file task
  list across seven tasks (package setup, connection, schema, queries,
  local-dev compose, barrel, smoke).
- Locked nine design decisions up front: pins collapse to a boolean
  on `canvas_blocks` (no `pins` table), block kinds drop to
  `text | image | file` (no `snippet`), every block carries
  `createdBy` provenance, canvas blocks use `deleted_at` soft-delete,
  guideline sections are normalized to their own table, one canvas
  per project (unique constraint), `agent_messages` deferred to
  Phase 6, ids are `uuid defaultRandom()`, timestamps are
  `timestamptz` with pgEnums for stable value sets.
- Enumerated open questions with leanings (enum volatility,
  `canvas_events.block_id` FK, position rebalancing, canvas-per-
  project cardinality, event payload shape) so execution had clear
  defaults.
- Archived to `docs/archive/phase-2-database-package.md` on
  completion.

### Prerequisite shared amendments — `packages/shared`

Small, localized patch to line shared up with the locked DB shape
before any Drizzle file was written.

- `project/canvas.ts` — `SnippetCanvasBlockSchema` dropped from the
  union. `PinIdSchema` / `PinCreatedBySchema` / `PinSchema` removed
  entirely (pins are a block boolean now, not a row). `CanvasBlockKind`
  → `z.enum(['text', 'image', 'file'])`. `CanvasBlockBaseShape` gained
  `isPinned`, `pinnedAt`, `createdBy`, `deletedAt`. `ShortlistView`
  stays — still a derived projection, now computed from
  `is_pinned = true AND deleted_at IS NULL`.
- `ids.ts` — `PinIdSchema` / `PinId` removed.
- `agent/events.ts` — `CanvasOpSchema` payloads no longer carry
  `SnippetCanvasBlock`; `PinOpSchema` stays (pin / unpin ops still
  flow on the stream) but no longer references `PinSchema`.

### Phase 2 implementation — `packages/db`

Seven source files under `src/schema/`, six under `src/queries/`, one
mapper module, one client, one barrel.

- **Package setup.** `package.json` pulls `drizzle-orm` + `pg` as
  runtime deps and `drizzle-kit` + `@types/pg` + `tsx` as dev deps.
  Scripts: `db:generate`, `db:migrate`, `db:studio`, `smoke`, plus
  the usual `lint` / `typecheck` / `format:check`. `tsconfig.json`
  extends the base with `rootDir: .` and `outDir: dist` so scripts
  and src compile together. `drizzle.config.ts` reads
  `DATABASE_URL`, points at `src/schema/**/*.ts` → `drizzle/`.
- **Connection module.** `src/client.ts` — reads `DATABASE_URL`
  (throws if missing), constructs a singleton pg `Pool`, and exports
  `db = drizzle(pool, { schema })` so the drizzle query builder is
  typed end-to-end against the schema map.
- **Schema (8 tables, 6 pgEnums).**
  - `users` — `id`, `email` (unique), `display_name` (nullable),
    timestamps. V1 stub to own workspaces and be the FK target for
    `canvas_events.user_id`; real auth columns land with Phase 3.
  - `workspaces` — `owner_user_id` FK → users `ON DELETE restrict`,
    index on `(owner_user_id)`.
  - `brands` — `workspace_id` FK `ON DELETE cascade`, index on
    `(workspace_id)`.
  - `guideline_sections` — FK to brand, `label`, `body` (jsonb —
    ProseMirror doc), integer `priority`, `createdBy` pgEnum,
    timestamps. Index on `(brand_id, priority)` for ordered reads.
  - `projects` — `kind` pgEnum (`freeform | standardized`),
    `template_id text nullable` (app-layer enforces non-null when
    `kind = 'standardized'`), FK to brand.
  - `canvases` — `project_id` FK + **unique** (one canvas per
    project in V1).
  - `canvas_blocks` — one wide table with nullable per-kind columns
    (`body`, `blob_key`, `alt`, `width`, `height`, `filename`,
    `mime`) rather than table-per-kind, matching shared's
    discriminated union. Carries `is_pinned` / `pinned_at`,
    `created_by`, `deleted_at`, integer `position`. Three partial
    indexes: active layout
    `(canvas_id, position) WHERE deleted_at IS NULL`, shortlist
    `(canvas_id) WHERE deleted_at IS NULL AND is_pinned = true`,
    and `(canvas_id, deleted_at)` for housekeeping.
  - `canvas_events` — append-only. FK to canvas, `block_id uuid`
    **without FK** (log survives any future hard-delete path), op
    + actor pgEnums, `user_id` FK `ON DELETE set null`, `payload`
    jsonb. Only `created_at` — no `updated_at`. Indexes:
    `(canvas_id, created_at desc)` for the canvas timeline and
    `(block_id, created_at desc) WHERE block_id IS NOT NULL` for
    per-block history.
- **Mappers.** `src/mappers.ts` — row → shared-type converters for
  workspaces, brands, guideline sections, projects, canvases, and
  canvas blocks. `rowToProject` discriminates on `kind`; throws on a
  null `template_id` when kind is `standardized`. `rowToCanvasBlock`
  reconstructs the discriminated union on read and throws on missing
  per-kind columns — a loud data-integrity signal, not a silent
  fallback.
- **Query helpers (18, grouped by aggregate).** Dumb CRUD, no
  business rules. Inputs typed against `@brandfactory/shared` where
  they map 1:1, returns flow back through the mappers.
  - `users.ts` — `getUserById`, `getUserByEmail`, `createUser`.
    `User` type exposed as the inferred row (shared doesn't model
    users yet).
  - `workspaces.ts` — `getWorkspaceById`, `listWorkspacesByOwner`,
    `createWorkspace`.
  - `brands.ts` — `getBrandById`, `listBrandsByWorkspace`,
    `createBrand`, `listSectionsByBrand`, `upsertSection` (update
    when `id` supplied, insert otherwise), `reorderSections`
    (wrapped in a single transaction).
  - `projects.ts` — `getProjectById`, `listProjectsByBrand`,
    `createProject` with a distributive union input so
    `standardized` projects carry `templateId` at the type level.
  - `canvas.ts` — `getCanvasByProject`, `listActiveBlocks`,
    `createBlock` (switches on `kind` to build the insert payload),
    `updateBlock`, `softDeleteBlock`, `restoreBlock`, `setPinned`
    (stamps / clears `pinned_at`), `getShortlistView` (joins
    `canvases` to filter by `projectId` and returns
    `ShortlistView`).
  - `events.ts` — `appendCanvasEvent`, `listCanvasEvents` (supports
    `since` + `limit`, `desc(created_at)`), `listBlockEvents`
    (`asc(created_at)`, carries `IS NOT NULL` so the partial index
    on `block_id` is usable).
- **Barrel.** `src/index.ts` re-exports `db`, `pool`, the full
  schema barrel, and every query module.

### Local dev Postgres — `docker/` + repo-root `.env.example`

- `docker/compose.yaml` — single `postgres:16` service,
  `brandfactory`/`brandfactory`/`brandfactory`
  user/password/database, port 5432, named volume
  `postgres_data`, `pg_isready` healthcheck.
- `docker/README.md` — one paragraph: `up -d postgres` to start,
  `down -v` to nuke.
- Repo-root `.env.example` — single `DATABASE_URL` line matching
  the compose credentials. Also documents that drizzle-kit does
  not auto-load `.env` — export or prefix the command.
- `.prettierignore` — excludes `packages/*/drizzle/` so generated
  migration artifacts don't fail `format:check`.

### Smoke check — `packages/db/scripts/smoke.ts`

Runs end-to-end against the docker Postgres after `db:generate` +
`db:migrate`. Creates a user, workspace, brand, two guideline
sections, a freeform project, a canvas (direct insert — no
`createCanvas` helper yet), a pinned text block, appends
`add_block` + `pin` events, asserts the shortlist contains exactly
one block, soft-deletes it, appends `remove_block`, asserts
shortlist empty, and finally asserts
`listBlockEvents` returns `[add_block, pin, remove_block]` in
chronological order. Closes the pool in `finally`. Exits 0 on
success, non-zero on assertion failure. Idempotent re-runs aren't
a goal — canonical reset is `docker compose down -v`.

### Drizzle / pg API notes

- `pgTable` third argument is an array (`(table) => [...]`) in
  drizzle-orm 0.36, not the object form from older releases.
- Partial indexes use `.where(sql\`…\`)` on the index builder —
  generates the `WHERE …` clause verbatim in the migration SQL.
- `timestamp(..., { withTimezone: true, mode: 'string' })` gives
  `timestamptz` columns that round-trip as ISO-8601 strings, which
  is what `z.iso.datetime()` in shared already expects.
- `pgEnum` values land as a real `CREATE TYPE` in the migration;
  adding a value later is a one-liner (`ALTER TYPE ADD VALUE`),
  removing a value is not — that trade-off is accepted for the
  value sets defined here.
- `defaultRandom()` on a `uuid` column compiles to
  `DEFAULT gen_random_uuid()`; Postgres 13+ has it built in, no
  `pgcrypto` extension required.

### Phase 2 completion record — `docs/completions/phase2.md`

Phase-level wrap with per-task records (`phase2-task1.md`
through `phase2-task7.md`). Captures the nine locked design
decisions delivered as specified, how each open question landed
(enums kept as `pg_enum`, no FK on `canvas_events.block_id`,
position rebalancing deferred until first collision, strict 1:1
canvas-per-project, plain jsonb event payloads validated at the
app layer), and the cross-cutting changes outside `packages/db`
(shared amendments, docker compose, repo `.env.example`,
`.prettierignore`). Also documents what Phase 2 explicitly did
*not* include (no auth / realtime / HTTP routes / agent_messages /
seed data / multi-service compose / RLS — all per the plan's
exclusion list) and the three intentional omissions from the
plan itself: no build pipeline (exports `src/index.ts` directly,
matching every other `workspace:*` package), no `createCanvas`
helper (the plan's Task 4 list didn't include it), no
parse-at-boundary runtime validation on reads (casts suffice for
trusted rows; Phase 9 hardening owns that call).

### Verification

All green against a running docker-compose Postgres:

```
pnpm install                                   ✔
pnpm -F @brandfactory/db db:generate           ✔   8 tables → 0000_eager_deathstrike.sql
pnpm -F @brandfactory/db db:migrate            ✔   applied cleanly
psql \dt                                       ✔   8 tables present
pnpm -F @brandfactory/db smoke                 ✔   smoke: OK (all assertions pass)
pnpm lint                                      ✔   0 problems
pnpm typecheck                                 ✔   9/9 workspaces pass
pnpm format:check                              ✔   all files clean
```

---

## 0.2.0 — 2026-04-18

First runtime code in the repo. `@brandfactory/shared` is now the wire
contract every other package builds against: schema-first with zod, types
inferred, zero business logic, one runtime dep (`zod ^4.3.6`). Both
`packages/server` and `packages/web` depend on it via `workspace:*` and
successfully parse a `BrandSchema` payload end-to-end.

### Phase 1 execution plan — `docs/executing/phase-1-shared-package.md`

- Expanded Phase 1 of the scaffolding plan into a concrete, methodical
  file-by-file task list before any code was written.
- Locked five design decisions up front: brand guidelines are fully
  dynamic (no category enum), sections are normalized (their own table in
  Phase 2), suggested categories ship as seed data, section body =
  ProseMirror/TipTap JSON, concurrency v1 = section-level last-write-wins.
- Enumerated open questions with leanings (`createdBy` on sections,
  integer `priority`, derived `ShortlistView`) so execution had clear
  defaults.

### Phase 1 implementation — `packages/shared`

Nine source files under `src/`, grouped by domain, behind a single barrel.

- **Primitives.** `json.ts` — recursive `JsonValue` + `ProseMirrorDoc`
  alias (typed as generic JSON at the schema boundary; TipTap enforces
  ProseMirror validity client-side). `ids.ts` — `brandedId<TBrand>()`
  helper plus eight concrete branded ids (`BrandId`, `WorkspaceId`,
  `ProjectId`, `CanvasId`, `CanvasBlockId`, `PinId`, `SectionId`,
  `UserId`). Runtime is a plain string; the compile-time type is nominal
  so `BrandId` and `ProjectId` are not interchangeable.
- **Workspace.** `workspace/workspace.ts` — `id`, `name`, `ownerUserId`,
  timestamps. No membership/permissions until multi-user flows land.
- **Brand + guidelines.** `brand/brand.ts` exports three schemas:
  `BrandSchema` (the row, no embedded sections), `BrandSummarySchema`
  (`pick` projection for list/picker surfaces) and
  `BrandWithSectionsSchema` (API-level join shape).
  `brand/guideline-section.ts` — fully user-defined sections:
  free-text `label`, `body: ProseMirrorDoc`, sparse-integer `priority`,
  `createdBy: 'user' | 'agent'`, timestamps. No hardcoded category enum.
  `brand/suggested-categories.ts` — static `SUGGESTED_SECTIONS` seed
  (Voice & tone, Target audience, Values & positioning, Visual guidelines,
  Messaging frameworks) rendered by the frontend as a starter picker.
  Data, not schema.
- **Project + canvas.** `project/project.ts` — discriminated union on
  `kind`: `freeform` vs `standardized` (with `templateId`).
  `project/canvas.ts` — `CanvasSchema` container, `CanvasBlockSchema`
  4-way discriminated union (`text`, `image`, `file`, `snippet`),
  `PinSchema`, and `ShortlistViewSchema` as a derived projection
  (not a stored entity). Base shapes are plain TS object literals spread
  into each branch, keeping zod's discriminated-union fast path intact.
- **Agent event stream.** `agent/events.ts` — `AgentMessageSchema`,
  `AgentToolCallSchema`, `CanvasOpSchema` (add-block / update-block /
  remove-block), `PinOpSchema` (pin / unpin), event-stream envelopes
  (`CanvasOpEventSchema`, `PinOpEventSchema`) and the outer
  `AgentEventSchema`. The outer union uses `z.union` rather than
  `z.discriminatedUnion` because two branches wrap an inner discriminated
  union on `op` — a pattern zod's discriminated-union fast path doesn't
  accept.
- **Conventions.** Schema-first with `z.infer` types, `z.iso.datetime()`
  at every timestamp, no defaults, no business logic, no validators or
  guards. ESM-only, zero runtime deps beyond `zod`.

### Consumer wiring

- `packages/server` and `packages/web` each gained
  `@brandfactory/shared: workspace:*` as a dependency. These wire-ups
  would have been needed by Phases 4 / 7 anyway; landing them now let the
  smoke check actually exercise the cross-package `import`.

### Zod 4 API notes

- Datetimes use `z.iso.datetime()` (zod 4 form; the v3 `z.string().datetime()`
  still works but is deprecated).
- Integers use `z.number().int()` — universal across zod 4 minor
  versions, no behaviour difference vs the top-level `z.int()` helper.
- `z.record(z.string(), V)` — zod 4 requires both key and value schemas.

### Phase 1 completion record — `docs/completions/phase1.md`

Full record of what was written, where, and why. Includes the five
locked design decisions, the plan's open questions resolved with
justification, and the in-flight refinements to the execution plan
(`ProjectBase` / `CanvasBlockBase` as plain object literals,
`AgentEventSchema` as `z.union`, `BrandSummary` added as a `pick`
projection, `GuidelineSectionCreatedBySchema` / `PinCreatedBySchema`
exported as separate enums to hedge against future divergence). Also
documents the cross-package `BrandSchema.parse(...)` probe and what
Phase 1 explicitly does *not* include (Drizzle schema, curation UI,
Yjs/CRDT, prompt assembly, validators).

### Verification

All green on a fresh install:

```
pnpm install       ✔
pnpm lint          ✔  0 problems
pnpm typecheck     ✔  9/9 workspaces pass
pnpm format:check  ✔
```

End-to-end probe: `BrandSchema.parse(...)` round-trips from both
`packages/server/src/index.ts` and `packages/web/src/index.ts` against
a literal payload, typed with the inferred `Brand`. Probe reverted after
verification — the runtime code still lives only in `packages/shared`.

---

## 0.1.0 — 2026-04-18

First tagged milestone. Lays the conceptual and structural groundwork for
every phase that follows. No runtime code yet — the repo installs, lints,
and typechecks on a flat pnpm workspaces skeleton.

### Vision & product docs

- **`docs/vision.md`** — full product vision. Brand as single source of
  truth; workspaces; projects (freeform and standardized templates); the
  universal Ideate → Iterate → Finalize loop; split-screen agent + canvas
  surface; who it's for; what's explicitly out of scope.
- **`docs/highlevel-vision.md`** — condensed one-pager version of the
  above, intended for README-style contexts.
- **`docs/ref/example-brand-wikis.md`** — reference material for brand
  guideline shapes we want to support.

### Architecture blueprint — `docs/architecture.md`

- Stack decision: **Vite + React + TS** (frontend), **Node + Hono + TS**
  (backend), **Drizzle on any Postgres** (Supabase as default adapter),
  **Vercel AI SDK** with **OpenRouter + Anthropic native + Ollama + OpenAI**
  as simultaneously-available LLM providers, selectable per workspace from
  a frontend settings page.
- Repo shape: flat `packages/*` monorepo (no `apps/` vs `packages/`
  split), scoped names `@brandfactory/*`, adapter sub-grouping under
  `packages/adapters/*`.
- Module boundaries documented for `shared`, `db`, `agent`, and
  `adapters`. `packages/agent` is explicitly **backend-only** — consumed
  by `server`, not by `web`. The wire contract (event shapes, tool-call
  signatures) lives in `packages/shared`.
- Ports-and-adapters pattern spelled out with concrete LLM/storage/auth
  examples. Domain code depends on the capability, not the vendor.
- Data-flow walkthrough, self-hosting story, extensibility surface, and
  pending decisions (auth for non-Supabase deployments, canvas conflict
  resolution, agent in-process vs worker, LLM settings storage).

### Scaffolding implementation plan — `docs/executing/scaffolding-plan.md`

- 10 phases (0 – 9) from repo foundation to hardening pass.
- Each phase defines a concrete outcome, a checkboxed task list, and a
  smoke check so it's unambiguous when the phase is done.
- Phases named by target directory (`packages/server`, `packages/web`)
  rather than `apps/` to match the flat layout.
- Explicit non-goals for the scaffolding effort (standardized templates,
  public shareable pages, CRDT collaboration, integrations, billing) so
  we don't scope-creep the foundation.

### Phase 0 implementation — repo foundation

Everything required to `pnpm install && pnpm lint && pnpm typecheck` on a
fresh clone.

- **Root tooling:** `package.json` (scripts: `dev`, `build`, `lint`,
  `lint:fix`, `format`, `format:check`, `typecheck`, `test`, `prepare`),
  `pnpm-workspace.yaml`, `.nvmrc` (Node 20 LTS floor), `.editorconfig`,
  `.gitignore`, `.gitattributes`, `.prettierrc`, `.prettierignore`
  (`docs/` excluded so authored prose isn't auto-rewrapped),
  `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` +
  `verbatimModuleSyntax` + `isolatedModules`), root `tsconfig.json`,
  `eslint.config.js` (ESLint 9 flat config: `@eslint/js` recommended →
  `typescript-eslint` recommended → `eslint-config-prettier`),
  `.husky/pre-commit` running `pnpm lint-staged` on commit,
  `scripts/dev.sh` placeholder.
- **9 peer workspaces** created with matching `package.json` +
  `tsconfig.json` + `src/index.ts` stubs: `@brandfactory/web`,
  `@brandfactory/server`, `@brandfactory/shared`, `@brandfactory/db`,
  `@brandfactory/agent`, `@brandfactory/adapter-auth`,
  `@brandfactory/adapter-storage`, `@brandfactory/adapter-realtime`,
  `@brandfactory/adapter-llm`.
- **Dev tooling pinned:** ESLint 9, Prettier 3, TypeScript 5.6,
  typescript-eslint 8, husky 9, lint-staged 15, `@types/node` 22. No
  runtime dependencies yet — those land with the phases that need them.

### Phase 0 completion record — `docs/completions/phase0.md`

Full record of what was written, where, and why, including decisions
made during execution (e.g. deferring TypeScript project references,
excluding `docs/` from Prettier, keeping pre-commit fast by leaving
`tsc` out of the hook). Also lists what Phase 0 explicitly does *not*
include so Phase 1 can land without ambiguity.

### Verification

All green on a fresh install:

```
pnpm install       ✔
pnpm lint          ✔  0 problems
pnpm typecheck     ✔  9/9 workspaces pass
pnpm format:check  ✔
```
