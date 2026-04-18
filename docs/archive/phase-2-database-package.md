# Phase 2 Implementation Plan — Database Package (`@brandfactory/db`)

Goal: stand up `packages/db` as the typed, migration-driven Postgres layer
that every other package talks to. Drizzle ORM against any Postgres,
`DATABASE_URL`-configured, schema mirrors `@brandfactory/shared`.

This plan expands [Phase 2 of the scaffolding plan](./scaffolding-plan.md#phase-2--database-package)
with the design decisions made during discussion and a file-by-file task
list we can execute methodically.

---

## Locked design decisions

1. **Pins are a boolean, not a table.** `canvas_blocks` carries
   `is_pinned: boolean` + `pinned_at: timestamptz?`. The `pins` table
   from the original scaffolding plan is dropped. Full pin/unpin history
   lives in the `canvas_events` log.
2. **Canvas block kinds collapse to `text | image | file`.** The
   `snippet` kind is gone — "snipped" content pasted from anywhere is
   just text. Future enrichment (url / title / paragraph) lands as an
   optional column later, not in V1.
3. **Provenance on every block.** `canvas_blocks.created_by: 'user' | 'agent'`.
   For *which* specific user or agent run, consult the event log.
4. **Soft-deletion of canvas blocks.** `canvas_blocks.deleted_at: timestamptz?`.
   Discarded ideas hide, they don't vanish — vision-aligned ("discarded
   ideas aren't gone, just hidden"), and keeps FK integrity with the
   event log.
5. **Guideline sections are normalized.** Each section is its own row
   in `guideline_sections` (FK → brand), not embedded JSON on the brand
   row. Enables per-section queries, reordering, indexing, and agent
   upserts without rewriting the whole brand.
6. **One canvas per project, shared pin state across users.** V1 =
   single workspace of truth. No per-user canvas forks, no per-user
   shortlists.
7. **`agent_messages` deferred to Phase 6.** Assistant-message
   persistence lands with the agent endpoint, not here.
8. **IDs are `uuid` columns with `defaultRandom()`.** Shared schema
   stays branded-string-typed at the type level; on the wire and in the
   DB, they're uuids.
9. **Timestamps are `timestamptz`.** Enums are Postgres `pg_enum` where
   the value set is stable and small.

---

## Prerequisite: amendments to `@brandfactory/shared`

The DB schema mirrors shared. Before writing any Drizzle tables, update
Phase 1 output to match the locked decisions above. This is a small,
localized patch.

- [ ] `src/project/canvas.ts`:
  - Drop `SnippetCanvasBlockSchema` and remove it from the discriminated
    union.
  - Drop `PinIdSchema` import, `PinCreatedBySchema`, and `PinSchema`.
  - `CanvasBlockKindSchema` → `z.enum(['text', 'image', 'file'])`.
  - Add to `CanvasBlockBaseShape`:
    - `isPinned: z.boolean()`
    - `pinnedAt: z.iso.datetime().nullable()`
    - `createdBy: z.enum(['user', 'agent'])`
    - `deletedAt: z.iso.datetime().nullable()`
  - `ShortlistViewSchema` stays — still a valid derived projection,
    just computed from `is_pinned = true AND deleted_at IS NULL`.
- [ ] `src/ids.ts`: drop `PinIdSchema` / `PinId` (no table, no id).
- [ ] `src/agent/events.ts`:
  - `PinOpSchema` stays in concept (pin / unpin ops exist on the
    stream), but stops referencing `PinSchema` — ops carry `blockId`,
    not a pin row.
  - Any `SnippetCanvasBlock` references in `CanvasOpSchema` payload
    types disappear with the union update.
- [ ] `src/index.ts`: barrel re-export updated.
- [ ] Verify clean: `pnpm --filter @brandfactory/shared typecheck`,
  `pnpm --filter @brandfactory/server typecheck`,
  `pnpm --filter @brandfactory/web typecheck`, repo-wide `lint` and
  `format:check`.

---

## Implementation tasks

### 1. Package setup (`packages/db`)

- [ ] `package.json`:
  - runtime deps: `drizzle-orm`, `pg`
  - dev deps: `drizzle-kit`, `@types/pg`, `tsx`
  - scripts: `db:generate`, `db:migrate`, `db:studio`, `smoke`
    (runs `scripts/smoke.ts` via tsx), plus the standard `lint`,
    `typecheck`, `format:check` delegating to root tooling.
- [ ] `tsconfig.json` extends base, adds `outDir: dist`.
- [ ] `drizzle.config.ts` at package root: schema glob
  `./src/schema/**/*.ts`, out `./drizzle`, dialect `postgresql`,
  credentials from `DATABASE_URL`.
- [ ] `.env.example` at package root documenting `DATABASE_URL`.

### 2. Connection module

- [ ] `src/client.ts`:
  - reads `DATABASE_URL` (throws if missing)
  - exports a singleton `db` (drizzle-orm pg driver) and the
    underlying `pool`.
  - default pool config; revisit in Phase 9.

### 3. Schema files (`src/schema/`)

One file per aggregate. Columns, FKs, indexes, enums declared inline
with Drizzle's `pgTable` / `pgEnum`. All tables have `created_at` and
`updated_at: timestamptz` except `canvas_events` (append-only, no
update).

- [ ] `src/schema/users.ts`
  - `users`: `id` (uuid pk), `email` (text unique not null),
    `display_name` (text), timestamps.
  - V1 scope: just enough to own workspaces and be the FK target for
    `canvas_events.user_id`. Real auth fields land with the auth
    adapter (Phase 3).
- [ ] `src/schema/workspaces.ts`
  - `workspaces`: `id`, `name`, `owner_user_id` (fk → `users.id`, on
    delete restrict), timestamps.
  - Index: `(owner_user_id)`.
- [ ] `src/schema/brands.ts`
  - `brands`: `id`, `workspace_id` (fk → `workspaces.id`, on delete
    cascade), `name`, `description` (text nullable), timestamps.
  - Index: `(workspace_id)`.
- [ ] `src/schema/guideline_sections.ts`
  - Enum `guideline_section_created_by`: `'user' | 'agent'`.
  - `guideline_sections`: `id`, `brand_id` (fk → `brands`, on delete
    cascade), `label` (text not null), `body` (jsonb — ProseMirror
    doc), `priority` (integer not null), `created_by` (enum),
    timestamps.
  - Index: `(brand_id, priority)` for ordered reads.
- [ ] `src/schema/projects.ts`
  - Enum `project_kind`: `'freeform' | 'standardized'`.
  - `projects`: `id`, `brand_id` (fk → `brands`, on delete cascade),
    `kind` (enum), `template_id` (text nullable — non-null only when
    `kind = 'standardized'`, enforced at the app layer in V1),
    `name`, timestamps.
  - Index: `(brand_id)`.
- [ ] `src/schema/canvases.ts`
  - `canvases`: `id`, `project_id` (fk → `projects`, on delete
    cascade, **unique** — one canvas per project in V1),
    timestamps.
- [ ] `src/schema/canvas_blocks.ts`
  - Enum `canvas_block_kind`: `'text' | 'image' | 'file'`.
  - Enum `canvas_block_created_by`: `'user' | 'agent'`.
  - `canvas_blocks`:
    - `id`, `canvas_id` (fk → `canvases`, on delete cascade)
    - `kind` (enum)
    - `position` (integer not null) — sparse ints, rebalance on
      collision; same rationale as `guideline_sections.priority`.
    - `is_pinned` (boolean not null default false)
    - `pinned_at` (timestamptz nullable)
    - `created_by` (enum)
    - `deleted_at` (timestamptz nullable) — soft-delete
    - timestamps
    - kind-specific columns (all nullable, validated at the app
      layer against the shared discriminated union):
      - `body` jsonb — text blocks (ProseMirror doc)
      - `blob_key` text — image + file
      - `alt` text, `width` int, `height` int — image
      - `filename` text, `mime` text — file
  - Indexes:
    - `(canvas_id, position) WHERE deleted_at IS NULL` — active
      layout reads.
    - `(canvas_id) WHERE deleted_at IS NULL AND is_pinned = true`
      — shortlist view.
    - `(canvas_id, deleted_at)` — housekeeping / hidden-view.
  - Design note: one wide table with nullable per-kind columns,
    rather than table-per-kind. Matches shared's discriminated union,
    keeps event payloads simple, avoids a join on every read.
- [ ] `src/schema/canvas_events.ts`
  - Enum `canvas_event_op`:
    `'add_block' | 'update_block' | 'remove_block' | 'restore_block' | 'pin' | 'unpin'`.
  - Enum `canvas_event_actor`: `'user' | 'agent'`.
  - `canvas_events`:
    - `id`, `canvas_id` (fk → `canvases`, on delete cascade)
    - `block_id` (uuid nullable, **no FK** — see open question)
    - `op` (enum)
    - `actor` (enum)
    - `user_id` (fk → `users` nullable, set when `actor = 'user'`)
    - `payload` (jsonb — op-specific: full block snapshot on add,
      diff on update, empty object on pin/unpin/remove/restore)
    - `created_at` only. No `updated_at`. Append-only.
  - Indexes:
    - `(canvas_id, created_at desc)` — canvas timeline.
    - `(block_id, created_at desc) WHERE block_id IS NOT NULL` —
      per-block history.
- [ ] `src/schema/index.ts`: barrel re-export of all tables + enums.

### 4. Query helpers (`src/queries/`)

Grouped by aggregate. Dumb reads/writes, no business rules. Each helper
takes the `db` from `client.ts`, accepts inputs typed by shared schemas
where they map 1:1, and returns shared types at the boundary.

- [ ] `src/queries/users.ts`: `getUserById`, `getUserByEmail`,
  `createUser`.
- [ ] `src/queries/workspaces.ts`: `getWorkspaceById`,
  `listWorkspacesByOwner`, `createWorkspace`.
- [ ] `src/queries/brands.ts`: `getBrandById`, `listBrandsByWorkspace`,
  `createBrand`, `listSectionsByBrand`, `upsertSection`,
  `reorderSections`.
- [ ] `src/queries/projects.ts`: `getProjectById`,
  `listProjectsByBrand`, `createProject`.
- [ ] `src/queries/canvas.ts`: `getCanvasByProject`,
  `listActiveBlocks(canvasId)`, `createBlock`, `updateBlock`,
  `softDeleteBlock`, `restoreBlock`, `setPinned(blockId, value)`,
  `getShortlistView(projectId)`.
- [ ] `src/queries/events.ts`: `appendCanvasEvent`,
  `listCanvasEvents(canvasId, { since?, limit? })`,
  `listBlockEvents(blockId)`.

### 5. Local dev Postgres

Minimal — just enough for the smoke check. The full multi-service
compose (server + web + caddy) lands in Phase 8.

- [ ] `docker/compose.yaml` at repo root with a single `postgres:16`
  service, named volume for persistence, port 5432 exposed, dev-only
  password.
- [ ] `.env.example` at repo root documenting `DATABASE_URL` for the
  compose setup.
- [ ] `docker/README.md` — one paragraph: `docker compose -f
  docker/compose.yaml up -d postgres`, reset via `down -v`.

### 6. Package barrel & exports

- [ ] `src/index.ts`: re-export `db`, `pool`, all schema tables + enums,
  all query helpers.
- [ ] `package.json` `exports` field maps `.` → built entry (ESM only).

### 7. Smoke check

Proof the package works end-to-end against a real Postgres. Captured as
`packages/db/scripts/smoke.ts`, runnable via `pnpm --filter @brandfactory/db smoke`.

Sequence:

1. `docker compose -f docker/compose.yaml up -d postgres`.
2. `pnpm --filter @brandfactory/db db:generate` — produces a migration
   under `packages/db/drizzle/`.
3. `pnpm --filter @brandfactory/db db:migrate` — applies it. Verify
   all eight tables exist (psql `\dt` or drizzle-studio).
4. `pnpm --filter @brandfactory/db smoke`:
   - insert a user
   - insert a workspace owned by that user
   - insert a brand in the workspace
   - insert two guideline sections
   - insert a freeform project
   - insert its canvas
   - insert a text `canvas_block` with `is_pinned=true`
   - append a `canvas_event` with `op='add_block'`, then another with
     `op='pin'`
   - read `getShortlistView(projectId)` → one block
   - `softDeleteBlock` it, append `op='remove_block'`
   - read `getShortlistView` again → empty
   - read `listBlockEvents` → `[add_block, pin, remove_block]` in
     order
   - exit 0.
5. Repo-wide `pnpm lint`, `pnpm typecheck`, `pnpm format:check` all
   green.

---

## What Phase 2 explicitly does NOT include

- **Auth logic / JWT verification** — Phase 3 (adapters).
- **Realtime pub/sub** — Phase 3.
- **HTTP routes and validation middleware** — Phase 4.
- **`agent_messages` table + persistence** — Phase 6.
- **Seed data** for first-run empty-state — Phase 8.
- **Multi-service docker compose** (server + web + caddy) — Phase 8.
- **Row-level security, tenant isolation, audit columns beyond
  `created_by` / `actor`** — Phase 9.
- **End-to-end integration tests** — Phase 9.

---

## Open questions (with leanings)

- **Enum migration pain.** Postgres enums are rigid —
  `ALTER TYPE ADD VALUE` is fine, removing a value is not. **Lean:**
  use `pg_enum` for the stable sets defined here. If a set proves
  volatile later, migrate it to `text` + check constraint.
- **FK on `canvas_events.block_id`.** **Lean:** no FK, so the log
  survives if we ever hard-delete a block (e.g. a GDPR erase). If we
  commit to soft-delete-only forever, add the FK in Phase 9.
- **Position rebalancing.** Sparse integers with rebalance on
  collision. Rebalance algorithm lives in `queries/canvas.ts`; initial
  implementation can be naive (renumber all blocks 1..N on collision)
  and optimize later.
- **Canvas per project cardinality.** V1 = strict 1:1, enforced by
  unique constraint on `canvases.project_id`. If multiple canvases per
  project ever make sense, drop the unique.
- **Payload shape for `canvas_events`.** `jsonb` with no schema at the
  DB level; validation happens at the app layer using `CanvasOpSchema`
  from shared. Revisit if we want queryable event bodies.

---

## Phase 2 completion record

On completion, document actuals in `docs/completions/phase2.md` in the
same style as `phase1.md`: what was written, where, design decisions
resolved during execution, Zod / Drizzle API notes, and the smoke-check
output.
