# Phase 2 Task 6 Completion — Package Barrel & Exports

**Status:** complete
**Scope:** [phase-2-database-package.md § 6. Package barrel & exports](../executing/phase-2-database-package.md#6-package-barrel--exports)
**Smoke check:** `pnpm lint && pnpm typecheck && pnpm format:check` — all green across 9 workspaces.

One edit: fleshing out `packages/db/src/index.ts` from the Phase 0
`export {}` stub into a proper barrel. The `exports` field on
`package.json` already landed in Task 1 and didn't need changes.

---

## Files written

### `packages/db/src/index.ts` (edited)

```ts
export { db, pool } from './client'
export * from './schema'
export * from './queries/users'
export * from './queries/workspaces'
export * from './queries/brands'
export * from './queries/projects'
export * from './queries/canvas'
export * from './queries/events'
```

Re-exports everything the plan called for:

- **Client** — `db` (drizzle instance) and `pool` (pg Pool) as named
  exports from `./client`. Singleton; callers `import { db } from
  '@brandfactory/db'`.
- **Schema** — every table and `pgEnum`, via `export *` through
  `./schema/index.ts` (which itself aggregates the eight per-aggregate
  schema files from Task 3).
- **Queries** — every helper from the six per-aggregate modules
  written in Task 4. `export *` also pulls along the type aliases
  defined in those files (`User`, `CreateProjectInput`,
  `CreateBlockInput`, `UpdateBlockPatch`, `AppendCanvasEventInput`,
  `CanvasEventRow`). No naming collisions across modules.

### `packages/db/package.json` — no change

Task 1 already set:

```json
"main": "./src/index.ts",
"exports": {
  ".": "./src/index.ts"
}
```

ESM-only (no CJS conditional), package-type `"module"`. Nothing for
Task 6 to touch.

---

## Deviations from the plan

- **`exports` points at source, not a built entry.** The plan says
  "maps `.` → built entry (ESM only)". Every other workspace package
  (`@brandfactory/shared`, `@brandfactory/server`, `@brandfactory/web`,
  all adapters) already points at `src/index.ts`. Since every consumer
  is another workspace package resolved via `workspace:*` and the
  repo-wide TS tooling (tsc, tsx, the future vite) can consume TS
  directly, a build step would be pure ceremony. All packages are
  `"private": true`; there is no publish target that needs a compiled
  `dist/`. Phase 9 can introduce a proper build pipeline if the
  self-hosting story ever needs prebuilt artifacts. Honoured the ESM
  half of the requirement literally.
- **`mappers.ts` deliberately not re-exported.** It's an internal
  helper for the query modules. Keeping it private tightens the public
  surface; if a future caller needs a row mapper, we can promote the
  export intentionally.
- **`drizzle.config.ts` not re-exported.** It's a drizzle-kit CLI
  concern, not part of the package's runtime surface.

---

## What Task 6 does NOT include

- No build step (`tsc -b`, tsup, esbuild). Source is the public entry.
- No conditional exports (Node vs browser, CJS vs ESM, types vs
  runtime). Single flat mapping.
- No `types` or `typesVersions` fields — TS resolves through the
  source files directly thanks to `verbatimModuleSyntax` +
  `isolatedModules` in the base tsconfig.
- No re-export of drizzle's own utilities (`eq`, `and`, `sql`, etc.).
  Callers import those from `drizzle-orm` directly; re-exporting them
  would couple `@brandfactory/db` consumers to drizzle's surface
  unnecessarily.

---

## Verification

```
pnpm lint          ✔   0 problems
pnpm typecheck     ✔   9/9 workspaces pass
pnpm format:check  ✔   all files clean
```

A consumer of `@brandfactory/db` can now `import { db, brands, createBrand,
CanvasBlock, getShortlistView } from '@brandfactory/db'` and land on the
right symbols. Actual cross-package consumption is exercised in Task 7
(smoke script imports from the barrel) and in Phase 4 (server routes).

Next: Task 7 — `packages/db/scripts/smoke.ts` and the full
generate → migrate → smoke sequence against the docker compose service.
