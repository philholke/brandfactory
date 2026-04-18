# Changelog

Latest releases at the top. Each version has a one-line entry in the index
below, with full detail further down.

## Index

- **0.3.0** — 2026-04-18 — Phase 2: `@brandfactory/db` lands — drizzle schema for 8 tables, singleton pg `Pool`, 18 query helpers, local-dev docker Postgres, and an end-to-end smoke check.
- **0.2.0** — 2026-04-18 — Phase 1: `@brandfactory/shared` lands as the single source of truth for domain types and zod schemas, consumed by both `server` and `web`.
- **0.1.0** — 2026-04-18 — Project bootstrap: vision, architecture blueprint, scaffolding plan, and Phase 0 repo foundation.

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
