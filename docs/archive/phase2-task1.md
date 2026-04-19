# Phase 2 Task 1 Completion — `@brandfactory/db` Package Setup

**Status:** complete
**Scope:** [phase-2-database-package.md § 1. Package setup](../executing/phase-2-database-package.md#1-package-setup-packagesdb)
**Smoke check:** `pnpm install && pnpm lint && pnpm typecheck && pnpm format:check` — all green.

Task 1 is pure scaffolding — no Drizzle tables, no connection module, no query
helpers. This record captures the four files written (or edited), the
dependency set introduced, and the small deviations from a literal reading of
the plan.

---

## Files written

### `packages/db/package.json` (edited)

Replaced the Phase 0 stub (which only had `typecheck` and `lint`) with the full
Task 1 shape. Scripts follow the plan's four-script block plus the three
standard scripts the rest of the monorepo uses:

- `db:generate` → `drizzle-kit generate`
- `db:migrate` → `drizzle-kit migrate`
- `db:studio` → `drizzle-kit studio`
- `smoke` → `tsx scripts/smoke.ts` (the script file itself lands in Task 7; the
  wiring is here so the smoke check has a stable command path.)
- `typecheck` → `tsc --noEmit`
- `lint` → `eslint .`
- `format:check` → `prettier --check .`

Runtime dependencies: `drizzle-orm ^0.36.4`, `pg ^8.13.1`.
Dev dependencies: `drizzle-kit ^0.28.1`, `@types/pg ^8.11.10`, `tsx ^4.19.2`.

No workspace dep on `@brandfactory/shared` at this step. The plan's Task 1
explicitly lists only `drizzle-orm` and `pg` as runtime deps. The shared
package gets wired in under Task 4 (query helpers) where the boundary
between shared types and DB rows actually exists.

### `packages/db/tsconfig.json` (edited)

Added `"outDir": "dist"` alongside the existing `rootDir: "src"`. Did **not**
flip `noEmit` — the base still has `noEmit: true`, so `tsc --noEmit` typechecks
without writing anything. `outDir` is in place for whenever Task 6 decides to
emit a built entry; today it's inert.

### `packages/db/drizzle.config.ts` (new)

Minimal `defineConfig` from `drizzle-kit`:

- `schema: './src/schema/**/*.ts'` — glob matches the plan's Task 3 layout.
- `out: './drizzle'` — matches the migration output path referenced in the
  plan's smoke-check (Task 7).
- `dialect: 'postgresql'`.
- `dbCredentials: { url: process.env.DATABASE_URL }`.

Throws a clear error at config-load time if `DATABASE_URL` is unset, so
drizzle-kit fails fast instead of surfacing an opaque connection error later.

Lives at the package root (not under `src/`), which means:

- ESLint **does** lint it (root flat config picks it up; only `*.config.js`
  variants are ignored, not `.ts`).
- The package `tsconfig.json` does **not** include it (`include: ["src/**/*.ts"]`).
  This is fine — drizzle-kit loads it via its own `tsx`-style loader.
- Prettier formats it via the root `format:check`.

### `packages/db/.env.example` (new)

Single `DATABASE_URL` entry with a sensible default that will match the docker
compose service introduced in Task 5
(`postgres://brandfactory:brandfactory@localhost:5432/brandfactory`). A short
comment notes that Supabase connection strings are plain Postgres URLs and
drop-in compatible.

---

## Deviations from the plan

- **`format:check` script added per-package.** The plan lists it as a standard
  script; the Phase 0 packages (`server`, `web`, `shared`, etc.) don't define
  one and rely on the root `prettier --check .`. Added it here for fidelity to
  the plan. It's harmless if never invoked per-package.
- **`@brandfactory/shared` dependency deferred.** Plan's Task 1 runtime-deps
  list doesn't mention it; query helpers (Task 4) are where the shared schemas
  actually get consumed. Adding it later keeps each task's scope honest.
- **`outDir` set but `noEmit` left on.** The plan says "adds `outDir: dist`"
  and stops there. Honoured the literal instruction; Task 6 can flip `noEmit`
  off and wire the `exports` map to the built entry if it chooses to.

---

## Open items for later tasks

- `src/client.ts` (Task 2) will read the same `DATABASE_URL` at runtime —
  the `.env.example` covers both drizzle-kit and the client.
- The `drizzle/` migration output folder will appear the first time
  `db:generate` runs (Task 3 produces schema, Task 7 runs generate+migrate).
  It's deliberately not committed as an empty directory.
- `packages/db/scripts/smoke.ts` (Task 7) is referenced by the `smoke`
  script but not yet present — running it today would fail with
  "file not found", which is expected.

---

## Verification

```
pnpm install       ✔   +34 packages resolved (drizzle-orm, drizzle-kit, pg, tsx
                       and transitive deps)
pnpm lint          ✔   0 problems
pnpm typecheck     ✔   9/9 workspaces pass
pnpm format:check  ✔   all files prettier-clean
```

Task 1 is complete. Next step: Phase 1 shared-package amendments (the plan's
"Prerequisite" section — `CanvasBlock` kinds collapse to `text | image | file`,
`Pin*` types removed, block gains `isPinned` / `pinnedAt` / `createdBy` /
`deletedAt`) before Task 2 (connection module) and Task 3 (schema files).
