# Phase 2 Task 2 Completion — Connection Module

**Status:** complete
**Scope:** [phase-2-database-package.md § 2. Connection module](../executing/phase-2-database-package.md#2-connection-module)
**Smoke check:** `pnpm --filter @brandfactory/db typecheck && pnpm lint && pnpm format:check` — all green.

Task 2 is one file: the singleton pg `Pool` + drizzle `db` instance that
every other query helper, migration, and app-side reader will import.

---

## Files written

### `packages/db/src/client.ts` (new)

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({ connectionString })
export const db = drizzle(pool)
```

Three deliberate choices:

- **Fail-fast on missing `DATABASE_URL`.** Import-time throw, not a runtime
  surprise on first query. Same convention `drizzle.config.ts` adopted in
  Task 1.
- **`drizzle-orm/node-postgres` driver.** Matches the `pg` runtime dep
  from Task 1. The HTTP / WebSocket drivers (Neon, Vercel) aren't in scope
  — the package targets "any Postgres via a plain connection string".
- **No `schema` argument passed to `drizzle(pool)` yet.** Schema files
  land in Task 3; once the barrel re-exports them, Task 3 can switch to
  `drizzle(pool, { schema })` so relational queries get typed table
  metadata. For now the untyped form is enough for the connection to
  stand on its own.

---

## Deviations from the plan

None. The plan's three bullets (reads `DATABASE_URL`, throws if missing,
exports singleton `db` + underlying `pool`, default pool config) are each
honoured literally.

---

## Explicit non-goals (per the plan's "default pool config; revisit in Phase 9")

- No `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, or `ssl`
  config on the pool. `pg` defaults apply (`max: 10`, 10s idle, etc.).
- No per-request transaction scoping helper — callers use `db.transaction(...)`
  directly when they need it.
- No connection-health probe on boot. If the URL is malformed or the
  server is down, the first query surfaces the error.

Phase 9 (hardening) owns pool sizing, TLS, and graceful shutdown.

---

## Verification

```
pnpm --filter @brandfactory/db typecheck   ✔
pnpm lint                                  ✔   0 problems
pnpm format:check                          ✔   all files clean
```

No runtime probe against a real Postgres yet — that happens in Task 7's
smoke script, after Task 3 (schema) and Task 4 (queries) give it something
to insert.

Next up: Task 3 — schema files under `src/schema/`, gated on the Phase 1
shared-package amendments (drop `Pin*`, collapse `CanvasBlockKind` to
`text | image | file`, add `isPinned` / `pinnedAt` / `createdBy` /
`deletedAt` to the block base).
