# Phase 2 Task 3 Completion — Schema Files + Shared Amendments

**Status:** complete
**Scope:** [phase-2-database-package.md § Prerequisite: amendments to `@brandfactory/shared`](../executing/phase-2-database-package.md#prerequisite-amendments-to-brandfactoryshared) and [§ 3. Schema files](../executing/phase-2-database-package.md#3-schema-files-srcschema)
**Smoke check:** `pnpm lint && pnpm typecheck && pnpm format:check` — all green across 9 workspaces.

Two bundles of work shipped together: the Phase 1 shared-package amendments
(the prerequisite gate) and the eight Drizzle schema files they unblocked.
Keeping them in one record because the schemas would not compile-check
against the old shared types and the shared deltas are meaningful only in
the context of the table layout they enable.

---

## Bundle A — Shared-package amendments

The Phase 1 types were built before the "pins are a boolean, not a table"
decision landed. Aligning shared with the locked Phase 2 design.

### `packages/shared/src/project/canvas.ts` (rewritten)

- Dropped `SnippetCanvasBlockSchema` / `SnippetCanvasBlock` and removed it
  from the `CanvasBlockSchema` discriminated union. "Snipped" content is
  now ordinary text.
- `CanvasBlockKindSchema` collapsed to `z.enum(['text', 'image', 'file'])`.
- Dropped `PinIdSchema` import, `PinCreatedBySchema`, `PinSchema`,
  `PinCreatedBy`, and `Pin`. No pins table = no pin schema.
- Introduced `CanvasBlockCreatedBySchema` (exported enum) — lives alongside
  `GuidelineSectionCreatedBySchema` as a separate enum rather than a shared
  one, consistent with the hedge-against-future-divergence note in
  `phase1.md`.
- `CanvasBlockBaseShape` gained four fields, mirroring the planned
  `canvas_blocks` columns exactly:
  - `isPinned: z.boolean()`
  - `pinnedAt: z.iso.datetime().nullable()`
  - `createdBy: CanvasBlockCreatedBySchema`
  - `deletedAt: z.iso.datetime().nullable()`
- `ShortlistViewSchema` preserved. Its docblock now points to the SQL
  predicate that computes it: `is_pinned = true AND deleted_at IS NULL`.

### `packages/shared/src/ids.ts` (edited)

- Removed `PinIdSchema` and the `PinId` type. Left every other branded id
  intact.

### `packages/shared/src/agent/events.ts` (no change needed)

- `PinOpSchema` already carried `blockId` rather than a pin-row reference,
  so no edit was required. `PinOpPinSchema` and `PinOpUnpinSchema` still
  live here — the ops stay in the stream; only the persistent entity behind
  them is gone.

### `packages/shared/src/index.ts` (no change needed)

- Barrel uses `export *`, which auto-dropped the removed symbols.

---

## Bundle B — Schema files (`packages/db/src/schema/`)

One file per aggregate, mirroring the plan's file list. All timestamps are
`timestamp('col', { withTimezone: true, mode: 'string' })` so the boundary
types match the `z.iso.datetime()` ISO-string convention already chosen in
shared. All tables carry `created_at` + `updated_at` with `defaultNow()`
except `canvas_events`, which is append-only.

### `users.ts`

`uuid` PK with `defaultRandom()`, `text` email with `unique()`, nullable
`display_name`, standard timestamps. V1 scope only — real auth fields land
with the auth adapter in Phase 3.

### `workspaces.ts`

`uuid` PK, `name`, `owner_user_id` FK → `users.id` with
`onDelete: 'restrict'` (can't delete a user out from under their
workspaces), timestamps, index on `(owner_user_id)`.

### `brands.ts`

`uuid` PK, `workspace_id` FK → `workspaces.id` with
`onDelete: 'cascade'` (delete a workspace, its brands go with it),
`name`, nullable `description`, timestamps, index on `(workspace_id)`.

### `guideline_sections.ts`

- Enum `guideline_section_created_by`: `'user' | 'agent'`.
- `brand_id` FK → `brands.id` cascade, `label`, `body` (jsonb —
  ProseMirror doc), `priority` (integer not null, sparse ints,
  no default), `created_by`.
- Index on `(brand_id, priority)` for ordered reads.

### `projects.ts`

- Enum `project_kind`: `'freeform' | 'standardized'`.
- `brand_id` FK → `brands.id` cascade, `kind`, nullable `template_id`,
  `name`, timestamps.
- Index on `(brand_id)`.
- App-layer validation enforces `template_id IS NOT NULL ⇔ kind = 'standardized'`.
  CHECK constraint deferred — can land in Phase 9 if needed.

### `canvases.ts`

- `project_id` FK → `projects.id` cascade + **unique** constraint: one
  canvas per project in V1. If multiple canvases per project ever makes
  sense, drop the unique.

### `canvas_blocks.ts`

- Two enums: `canvas_block_kind` (`text | image | file`) and
  `canvas_block_created_by` (`user | agent`).
- Common columns: `canvas_id` FK cascade, `kind`, `position` (int),
  `is_pinned` (default false), `pinnedAt` (nullable timestamptz),
  `created_by`, `deleted_at` (nullable timestamptz), timestamps.
- Kind-specific nullable columns on one wide table rather than
  table-per-kind: `body` (jsonb — text), `blob_key` (image + file),
  `alt`/`width`/`height` (image), `filename`/`mime` (file). The shared
  discriminated union is the source of truth on write; the DB accepts
  all as nullable.
- Partial indexes via `.where(sql\`...\`)`:
  - `(canvas_id, position) WHERE deleted_at IS NULL` — active layout
    reads.
  - `(canvas_id) WHERE deleted_at IS NULL AND is_pinned = true` — the
    shortlist view.
  - `(canvas_id, deleted_at)` — housekeeping / hidden-view.

### `canvas_events.ts`

- Enum `canvas_event_op`:
  `add_block | update_block | remove_block | restore_block | pin | unpin`.
- Enum `canvas_event_actor`: `user | agent`.
- Columns: `canvas_id` FK cascade, `block_id` (uuid nullable, **no FK**),
  `op`, `actor`, `user_id` FK → `users.id` with `onDelete: 'set null'`,
  `payload` (jsonb not null), `created_at` only — no `updated_at`,
  append-only.
- Indexes use `desc()` from `drizzle-orm` so the most-recent ordering is
  index-backed:
  - `(canvas_id, created_at desc)` — canvas timeline.
  - `(block_id, created_at desc) WHERE block_id IS NOT NULL` — per-block
    history.
- FK on `block_id` deliberately omitted so the log survives a future
  hard-delete (e.g. GDPR erase). Added in Phase 9 only if we commit to
  soft-delete-only forever.

### `index.ts`

Flat `export *` barrel of the eight schema files. No re-grouping — the
files themselves are already aggregate-grouped.

---

## Deviations from the plan

- **Shared `agent/events.ts` unchanged.** Plan says `PinOpSchema` should
  "stop referencing `PinSchema`" — it already didn't. No-op for this
  amendment.
- **`user_id` FK on `canvas_events` uses `onDelete: 'set null'`**, not
  left unspecified. The plan says "fk → `users` nullable, set when
  `actor = 'user'`". `set null` is the only behaviour that actually honours
  "append-only log survives user deletion"; `restrict` would block
  deletes, `cascade` would destroy history. Explicit choice, consistent
  with the `canvas_events.block_id` rationale.
- **`CanvasBlockCreatedBySchema` exported from shared.** Plan spec says
  inline `z.enum(['user', 'agent'])`; I pulled it out as a named export
  so the schema layer (`canvasBlockCreatedBy` pgEnum) has a stable
  counterpart name and to mirror the `GuidelineSectionCreatedBySchema`
  convention already established in Phase 1.
- **Timestamp mode `'string'` throughout.** Not specified by the plan
  either way. Chosen so the DB boundary returns the same ISO strings
  that `z.iso.datetime()` parses — zero conversion layer between the
  query helpers and the shared types.

---

## Drizzle API notes (0.28 / ORM 0.36)

- `pgTable(name, cols, (table) => [ /* indexes */ ])` — array-returning
  third argument works cleanly for multiple indexes without object keys.
- Partial indexes: `.where(sql\`…\`)` is the canonical form. Interpolate
  columns with `${table.col}`.
- Descending order in an index: `desc(table.col)` imported from
  `drizzle-orm` (not `pg-core`).
- `timestamp('col', { withTimezone: true, mode: 'string' })` — the two
  options always ride together in this package.
- `pgEnum('name', [...])` returns a callable — use it both as the column
  builder (`kind: canvasBlockKind('kind')`) and as an exported symbol.

---

## Explicit non-goals (per the plan's exclusions)

- No `agent_messages` — deferred to Phase 6.
- No seed data — Phase 8.
- No CHECK constraints on `projects.template_id`, `canvas_blocks.body`
  vs `kind`, etc. App-layer validation against shared schemas is the
  enforcement point in V1.
- No relational `relations()` helpers. Not needed by query helpers yet;
  easy to add later.
- `src/client.ts` still calls `drizzle(pool)` without a `schema`
  argument. Task 4 can switch to `drizzle(pool, { schema })` once the
  queries need typed relational access.

---

## Verification

```
pnpm lint          ✔   0 problems
pnpm typecheck     ✔   9/9 workspaces pass
pnpm format:check  ✔   all files prettier-clean
```

Runtime SQL generation is exercised in Task 7 (`db:generate` + `db:migrate`
against a local `postgres:16`). Task 3's green typecheck is the strongest
static signal available until then.

Next: Task 4 — query helpers under `src/queries/`, add `@brandfactory/shared`
as a runtime dep of `@brandfactory/db`, switch `client.ts` to
`drizzle(pool, { schema })`.
