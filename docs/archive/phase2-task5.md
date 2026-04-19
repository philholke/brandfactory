# Phase 2 Task 5 Completion — Local Dev Postgres

**Status:** complete
**Scope:** [phase-2-database-package.md § 5. Local dev Postgres](../executing/phase-2-database-package.md#5-local-dev-postgres)
**Smoke check:** `pnpm format:check` — green.

Three files, no runtime code. The goal is "just enough for the smoke
check" (Task 7); the full multi-service stack (server + web + caddy)
lands in Phase 8.

---

## Files written

### `docker/compose.yaml` (new)

Single `postgres:16` service:

- `container_name: brandfactory-postgres` so repeated runs land on the
  same container.
- Dev credentials `brandfactory / brandfactory / brandfactory`
  (user / password / db). Matches the `DATABASE_URL` shown in both
  `.env.example` files.
- Port 5432 bound to host 5432 so `packages/db` connects without any
  port-forwarding tricks.
- Named volume `postgres_data` mounted at `/var/lib/postgresql/data` so
  `up` / `down` (without `-v`) preserves data between restarts.
- Healthcheck via `pg_isready` — Task 7's smoke script can poll for
  "service healthy" instead of sleeping.
- No `restart:` policy — dev only, the developer controls the lifecycle.

### `docker/README.md` (new)

One-paragraph primer: the `up -d postgres` command, the `down -v` reset,
and the canonical `DATABASE_URL`. Also notes that the multi-service stack
is Phase 8.

### `.env.example` at repo root (new)

Documents `DATABASE_URL` with the exact connection string that matches
the compose service. Callout: drizzle-kit does **not** auto-load `.env`
files, so the variable needs to be exported (or prefixed on the command)
for `db:generate` / `db:migrate` / `db:studio` to pick it up.

---

## Deviations from the plan

- **Added a healthcheck.** Plan doesn't mention it; I included one
  because Task 7's smoke script will need to wait for postgres to accept
  connections, and a healthcheck is the idiomatic way to gate that. No
  runtime cost.
- **`container_name` set explicitly.** Plan doesn't mention it;
  including it makes `docker logs brandfactory-postgres` and `psql
  ... -h localhost` stable across `docker compose` invocations. Cheap
  ergonomics.

---

## Explicit non-goals

- **Not a production-grade config.** No TLS, no non-default `max_connections`,
  no backup strategy, no user/db separation. Phase 9 owns hardening.
- **No dotenv loader wired into drizzle-kit / `client.ts`.** The plan says
  document, not auto-load. Users `export` the variable or prefix the
  command. If this becomes a friction point, Phase 8 or a dedicated
  tooling pass can add `dotenv-cli`.
- **No Supabase-specific config.** Supabase is the default hosted adapter
  in the architecture blueprint; its connection string drops into
  `DATABASE_URL` unchanged, so the dev compose and the hosted path share
  one contract.

---

## Verification

```
pnpm format:check   ✔   all files clean (prettier formats yaml + md)
docker compose …    —   deferred to Task 7 (first real `up`)
```

Lint and typecheck not exercised because this task touches no TS files.

Next: Task 6 — package barrel (`src/index.ts` re-exports `db`, `pool`,
schema, query helpers) and the `exports` field on `packages/db/package.json`.
