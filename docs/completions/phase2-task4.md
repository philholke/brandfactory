# Phase 2 Task 4 Completion — Query Helpers

**Status:** complete
**Scope:** [phase-2-database-package.md § 4. Query helpers](../executing/phase-2-database-package.md#4-query-helpers-srcqueries)
**Smoke check:** `pnpm lint && pnpm --filter @brandfactory/db typecheck && pnpm format:check` — green.

Six aggregate-grouped query modules, a row→shared mapper module, a workspace
dep wire-up, and a one-line `client.ts` upgrade to pass the schema map to
drizzle. "Dumb reads/writes, no business rules." The six exported surface
signatures match the plan's enumeration exactly.

---

## Files written

### `packages/db/package.json` (edited)

Added `@brandfactory/shared: workspace:*` as a runtime dependency. Deferred
from Task 1 on purpose — Task 4 is where the shared↔DB boundary actually
materializes (inputs typed by shared, returns mapped to shared).

### `packages/db/src/client.ts` (edited)

```ts
import * as schema from './schema'
// …
export const db = drizzle(pool, { schema })
```

Passing `{ schema }` costs nothing today and unlocks drizzle's relational
query builder (`db.query.foo.findFirst`) for later callers without a
follow-up refactor.

### `packages/db/src/mappers.ts` (new)

Row→shared converters, one per aggregate that has a shared type:
`rowToWorkspace`, `rowToBrand`, `rowToGuidelineSection`, `rowToCanvas`,
`rowToProject`, `rowToCanvasBlock`.

Key behaviours:

- **Branded ids cast at the boundary.** e.g. `row.id as BrandId`. We trust
  the DB: these strings came from `uuid defaultRandom()`, not user input.
  Parse-via-zod at the boundary is a Phase 9 hardening question.
- **Discriminated-union reconstruction.** `rowToProject` branches on
  `row.kind`; `rowToCanvasBlock` branches and pulls kind-specific columns
  (body / blobKey+alt/width/height / blobKey+filename+mime).
- **Integrity-bug asserts over silent fallbacks.** If a `standardized`
  project row has null `templateId`, or an image block has null `blobKey`,
  the mapper throws. These states are unreachable if the app layer
  validates on write; if we ever see them, it's a bug we want to surface,
  not paper over.
- **Nullable→optional conversion for image dimensions / alt.** Shared
  uses `.optional()` (undefined), DB uses nullable. Mapper spreads
  conditionally so `alt` / `width` / `height` are absent when null rather
  than `{ alt: null }` — keeps the shared discriminated union exact.

### `packages/db/src/queries/users.ts` (new)

- `User = typeof users.$inferSelect` — shared doesn't define a user
  entity yet (Phase 3 auth adapter owns it). Returning the inferred row
  type is the honest choice for V1.
- `getUserById(UserId) → User | null`
- `getUserByEmail(email) → User | null`
- `createUser({ email, displayName? }) → User`

### `packages/db/src/queries/workspaces.ts` (new)

- `getWorkspaceById`, `listWorkspacesByOwner`, `createWorkspace` — all
  return `Workspace` via `rowToWorkspace`.

### `packages/db/src/queries/brands.ts` (new)

- `getBrandById`, `listBrandsByWorkspace`, `createBrand`.
- `listSectionsByBrand(brandId)` — orders by `priority asc` so the
  `(brand_id, priority)` index backs the read.
- `upsertSection(input)` — `id?` on the input decides create vs update.
  Update is scoped by `(id, brandId)` to prevent cross-brand bleed even
  with a guessed id. No business rules: caller owns auth and priority
  allocation.
- `reorderSections(brandId, updates[])` — runs every update inside a
  single transaction, then re-reads the brand's sections ordered by
  priority for the return value. Any missing id fails the whole batch
  via `throw`, rolling back the transaction.

### `packages/db/src/queries/projects.ts` (new)

- `CreateProjectInput` is a local discriminated union mirroring shared's
  `Project` union minus server-generated fields. `templateId` only on the
  `standardized` branch.
- `getProjectById`, `listProjectsByBrand`, `createProject` — all map
  through `rowToProject`.

### `packages/db/src/queries/canvas.ts` (new)

Eight functions, matching the plan's list verbatim:

- `getCanvasByProject(projectId) → Canvas | null`
- `listActiveBlocks(canvasId) → CanvasBlock[]` — `deleted_at IS NULL`,
  ordered by position asc (backed by the partial index).
- `createBlock(input)` — `CreateBlockInput` is a distributive union on
  `kind` intersected with the common block fields. Kind-specific fields
  are inserted into the correct nullable columns; the rest stay null.
- `updateBlock(id, patch)` — patch is `Partial<…>` over the mutable
  columns. `kind` intentionally not in the patch — swap by creating a
  new block.
- `softDeleteBlock(id)` — sets `deleted_at = now()`, bumps `updated_at`.
  Does **not** clear `is_pinned` / `pinned_at`; the shortlist index
  already excludes deleted rows, so the historical pin state is
  preserved for a future restore.
- `restoreBlock(id)` — sets `deleted_at = null`, bumps `updated_at`.
- `setPinned(id, value)` — sets `is_pinned`, and either stamps or
  clears `pinned_at` to match, bumps `updated_at`.
- `getShortlistView(projectId) → ShortlistView` — inner join
  `canvas_blocks ⨝ canvases` on project id, `is_pinned AND NOT
  deleted`, ordered by position. Returns the shared `ShortlistView`
  shape (project id + block id array).

### `packages/db/src/queries/events.ts` (new)

- `CanvasEventRow = typeof canvasEvents.$inferSelect` — the wire event
  stream lives in shared (`AgentEvent`), but the persisted log row is a
  storage concern and not mirrored in shared.
- `AppendCanvasEventInput` — caller provides `canvasId`, `op`, `actor`,
  `payload`, plus optional `blockId` and `userId`.
- `appendCanvasEvent`, `listCanvasEvents(canvasId, { since?, limit? })`,
  `listBlockEvents(blockId)`.
- **Ordering choices:** `listCanvasEvents` returns `desc(createdAt)` —
  timeline views want most-recent first; backed by
  `canvas_events_canvas_timeline_idx`. `listBlockEvents` returns
  `asc(createdAt)` — per-block history reads as the story of what
  happened, matching the smoke-check expectation `[add_block, pin,
  remove_block]` in order.

---

## Deviations / judgment calls (not spelled out in the plan)

- **`reorderSections` signature is `(brandId, updates[])`, not just
  `updates[]`.** Scoping updates to a single brand prevents a caller
  from accidentally reordering someone else's sections with a guessed
  id. Plan left the signature unspecified.
- **`upsertSection` update scoped by `(id, brandId)`.** Same reason.
- **`updated_at` bumped explicitly via `sql\`now()\`` on every write.**
  Drizzle's `.defaultNow()` fires on insert only; without an explicit
  bump, updates would leave `updated_at = created_at`. Explicit is
  clearer than adding a `$onUpdate` to every schema column.
- **`User` / `CanvasEventRow` returned as Drizzle inferred types.**
  Shared doesn't define these entities. Retrofitting shared for every
  DB table would bloat the wire contract with types that never cross
  the boundary.
- **`createCanvas` intentionally omitted.** Plan's Task 4 list doesn't
  include it; Task 7's smoke script can insert via `db.insert(canvases)`
  directly, or the server can add a helper when it needs one.

---

## What Task 4 does NOT include

- No relational query builder usage (`db.query.x.findFirst`). `select()`
  / `insert()` / `update()` cover every case at this stage; RQB is
  unlocked by passing `{ schema }` to `drizzle()` but not yet needed.
- No transaction helper surfaced from `client.ts` — callers use
  `db.transaction(async (tx) => …)` directly, as `reorderSections`
  demonstrates.
- No parse-at-boundary (`BrandSchema.parse(row)` etc). Casts suffice
  for trusted DB reads; runtime validation is a Phase 9 hardening
  question.
- No pagination beyond `listCanvasEvents`'s optional `limit`.

---

## Verification

```
pnpm install                              ✔   shared now linked into db
pnpm --filter @brandfactory/db typecheck  ✔
pnpm lint                                 ✔   0 problems
pnpm format:check                         ✔   all files clean
```

Runtime exercise of these helpers against real Postgres happens in Task 7.

Next: Task 5 — docker compose (`postgres:16`) + repo-root `.env.example`
+ `docker/README.md`.
