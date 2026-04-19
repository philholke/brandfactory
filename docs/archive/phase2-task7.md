# Phase 2 Task 7 Completion — Smoke Check

**Status:** complete
**Scope:** [phase-2-database-package.md § 7. Smoke check](../executing/phase-2-database-package.md#7-smoke-check)
**Smoke check:** See below — full `generate → migrate → smoke` sequence exited 0.

The runtime proof that `@brandfactory/db` works end-to-end against a real
Postgres. One new file (`packages/db/scripts/smoke.ts`), a `.prettierignore`
addition for the generated migration artifacts, and one follow-up edit to
`packages/db/tsconfig.json` to include `scripts/` in typechecking.

---

## Files written

### `packages/db/scripts/smoke.ts` (new)

Exercises the sequence the plan spells out, with `assert` / `assertEqual`
helpers that throw on failure so the script exits non-zero. Each step
prints the new row's id so a human reader can see progress. Pool is
closed in a `finally` block so the process exits cleanly.

The script imports everything from the package barrel (`../src`) —
confirming Task 6's wire-up works from an external entry point.

Canvas insertion uses `db.insert(canvases)` directly, matching the note in
Task 4's completion record that `createCanvas` was intentionally omitted
from the plan's query list.

### `packages/db/tsconfig.json` (edited)

```diff
- "rootDir": "src",
+ "rootDir": ".",
- "include": ["src/**/*.ts"]
+ "include": ["src/**/*.ts", "scripts/**/*.ts"]
```

Without this, `pnpm --filter @brandfactory/db typecheck` would skip the
smoke script entirely — it's invoked via `tsx` at runtime, which strips
types without checking them. Pulling `scripts/` into `tsc`'s view gives
us static safety for the one file that actually exercises the package
end-to-end. `rootDir` widened from `src` to `.` because the `scripts`
tree now lives outside `src`.

### `.prettierignore` (edited)

```diff
+ # Drizzle-generated migrations and snapshots — never hand-edit.
+ packages/*/drizzle/
```

`drizzle-kit generate` writes `packages/db/drizzle/0000_*.sql` and
`packages/db/drizzle/meta/*.json`. The JSON snapshots don't match prettier
formatting; rather than reformatting machine output, we exclude the whole
tree from prettier. The SQL and JSON files are the authoritative migration
artifacts — regenerating them is the way to change them, not hand-editing.

### `packages/db/drizzle/0000_eager_deathstrike.sql` (new, generated)

148-line SQL migration produced by `drizzle-kit generate`. Contains:

- 6 `CREATE TYPE ... AS ENUM` statements (one per pgEnum).
- 8 `CREATE TABLE` statements, in FK-safe dependency order.
- Foreign-key constraints with the `ON DELETE` behaviours configured in
  Task 3 (`restrict` on workspaces→users, `cascade` on children,
  `set null` on canvas_events→users).
- Partial indexes via `WHERE` clauses on `canvas_blocks` and
  `canvas_events` — confirmed rendered faithfully from the
  `.where(sql\`…\`)` calls in the schema files.
- `gen_random_uuid()` defaults on every uuid PK.

The accompanying `drizzle/meta/_journal.json` and `drizzle/meta/0000_snapshot.json`
are drizzle's internal bookkeeping.

---

## The runtime sequence (actual)

```
1. Start Docker Desktop (daemon came up after ~30s)
2. docker compose -f docker/compose.yaml up -d postgres
       → image pulled, postgres_data volume created,
         brandfactory-postgres started, healthy after ~5s
3. DATABASE_URL=... pnpm -F @brandfactory/db db:generate
       → 8 tables detected, emitted drizzle/0000_eager_deathstrike.sql
4. DATABASE_URL=... pnpm -F @brandfactory/db db:migrate
       → migrations applied successfully
5. psql \dt
       → 8 public tables: brands, canvas_blocks, canvas_events,
         canvases, guideline_sections, projects, users, workspaces
6. DATABASE_URL=... pnpm -F @brandfactory/db smoke
       → smoke: starting
         user       46642707-…
         workspace  a38d7f58-…
         brand      8911a0f1-…
         sections   3a435666-…, 96cfbc85-…
         project    05fca3d6-…
         canvas     2c494995-…
         block      9c63923a-… (pinned)
         events     add_block, pin
         shortlist  [9c63923a-…]
         events     remove_block
         shortlist  []
         history    add_block → pin → remove_block
         smoke: OK
7. pnpm lint && pnpm typecheck && pnpm format:check
       → all green across 9 workspaces
```

Every assertion in the plan's smoke sequence passed:

- Shortlist returns one block before soft-delete, empty after.
- `listBlockEvents` returns `[add_block, pin, remove_block]` in
  chronological order — backed by the
  `canvas_events_block_timeline_idx` partial index.
- `setPinned(true)` stamps `pinned_at`, and `soft_delete` does not
  re-clear `is_pinned` (the shortlist excludes deleted rows via the
  partial index, not by unpinning).

---

## Deviations / follow-ups noticed during the run

- **`drizzle-kit` doesn't autoload `.env`.** Confirmed — each command
  was prefixed with `DATABASE_URL=…`. The root `.env.example` already
  documents this; no code change needed.
- **Migration filename is non-deterministic** (`0000_eager_deathstrike.sql`).
  Drizzle uses its own name generator. The filename is stable once
  committed; subsequent `generate` calls only produce new files for
  schema changes.
- **Prettier needed a widened ignore list.** Drizzle's JSON snapshots
  aren't prettier-clean out of the box. Fixed here (not a per-package
  concern; lives at the repo root).
- **`scripts/` was silently unchecked.** Fixed the tsconfig so
  `typecheck` actually covers the smoke script.

---

## Phase 2 smoke check — verdict

Every bullet the plan laid out for Task 7 (steps 1–5) executed as
specified, with the sole exception that Docker Desktop needed to be
started manually before `docker compose up`. The package compiles,
migrates, round-trips real rows, maintains the event log invariants,
and closes its pool cleanly.

Next: the Phase 2 wrap-up doc at `docs/completions/phase2.md` referencing
all seven task records, and then on to Phase 3 (adapters).
