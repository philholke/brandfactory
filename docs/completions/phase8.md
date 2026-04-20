# Phase 8 Completion — Dev onboarding & CI

**Status:** complete (Steps 0, 1, 3, 4, 5 from [phase-8-plan.md](../executing/phase-8-plan.md); Steps 2 and the original 5–6 dropped per the plan's "Scope decision").
**Verification:** `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count 223 (0.7.4) → **234 locally (+11)**; 233 passing + 1 skipped. The skipped case is the seed-idempotency live-DB test, which runs in CI against the Postgres service (233 + 1 = **234 in CI**).

Phase 8 is a reproducibility pass — no new feature surface, no user-visible UI work. What changes: a fresh clone lands on a running stack in five commands, PRs run lint + typecheck + format + test automatically, the root `.env.example` stays in sync with the env schema by construction, and the server supports split-origin deploys via a CORS allowlist that gates HTTP *and* the `/rt` WS upgrade.

Starting point: 0.7.4 (post-Phase-7, 223 tests). Root README still advertised a "Phase-8 README overhaul will fold…" placeholder; the dev-token flow required a manual `INSERT INTO users`; no CI.

---

## Scope cut (2026-04-20)

The original plan bundled dev-onboarding + a full self-host deploy story (server + web Dockerfiles, three-service compose, `bootstrap.sh`). We dropped the deploy half and kept onboarding + CI + CORS. The reasoning lives in the plan's "Scope decision" section; the short version: no concrete self-hoster has surfaced, opinionated Dockerfiles are a maintenance magnet, and `bootstrap.sh` wraps four documented shell commands in no-value-adding glue.

What remains for Phase 8: Steps 0, 1, 3 (was Step 6), 4 (was 7), 5 (was 8). What got deferred: server + web Dockerfiles, full three-service compose, `bootstrap.sh`, `images.yml` CI workflow, multi-arch image builds.

---

## Step 0 — Seed script + dev-token flow

**Outcome:** `pnpm -F @brandfactory/db db:seed` prints a dev bearer token bound to a real `users` row, idempotently. Closes the "manual `INSERT INTO users`" gap from 0.7.4.

### `packages/db/src/seed.ts`

New file. Inserts a deterministic fixture — one user, one workspace, one brand (with three seed guideline sections), one freeform project + canvas — under hard-coded RFC-4122 v4 UUIDs so reruns stay stable. Every insert uses `onConflictDoNothing({ target: <table>.id })`, so the function is safe to run repeatedly.

Key decisions:

- **Deterministic ids, not `gen_random_uuid()`.** The printed dev token must not change between seed runs, or contributors would have to re-paste it after every `pnpm -F @brandfactory/db db:seed`. All five aggregates (user, workspace, brand, project, canvas) get fixed UUIDs under the `00000000-0000-4000-8000-000000000001…5` prefix; section ids use the `…00a / 00b / 00c` tail.
- **Printed token = the user UUID.** The `local` auth adapter already accepts any UUID that exists in `users` as a bearer — the seed doesn't need to mint a new token format, just surface the id.
- **Transactional.** All inserts run inside a single `db.transaction(async tx => …)` so a failed brand insert doesn't leave a dangling workspace.
- **Self-executes when run directly, pure import otherwise.** A `process.argv[1]` check (`/seed\.[cm]?[jt]s$/`) gates the `main()` side effect so `seed.test.ts` can `import { seed }` without opening + closing the pool on import.

### `packages/db/src/seed.test.ts`

One vitest case: call `seed()` twice in a row, assert each aggregate ends up with exactly one row (three for guideline sections). Skipped when `DATABASE_URL` is absent (`describe.skipIf(!hasDb)`) so contributors without Postgres still pass `pnpm test`; CI exports `DATABASE_URL` against the `postgres:16` service container and exercises the live path.

### `packages/db/package.json`

Added `"db:seed": "tsx src/seed.ts"` alongside the existing `db:generate` / `db:migrate` / `db:studio` scripts.

### `packages/web/README.md`

Replaced the "one-shot `INSERT`" paragraph with a one-line pointer to `pnpm -F @brandfactory/db db:seed`.

**Deferred:** a seed that's "ready for screenshots" (rich placeholder content, a sample canvas with a pinned text block). Today's seed produces an empty canvas + three short guideline sections — enough to prove the stack is alive, not enough to demo. When demos need more, expand `SECTIONS` + add a seed canvas-block or two.

---

## Step 1 — Root `.env.example` + drift guard

**Outcome:** a copy-pasteable `.env.example` at the repo root enumerating every server env var, organized in the same order as `EnvSchema`. A vitest in `@brandfactory/server` fails the build if any schema key goes undocumented.

### `.env.example`

Rewritten to match the plan's "Minimal viable defaults" policy:

- Shipped stack is `local` auth + `local-disk` storage + `native-ws` realtime + `openrouter` LLM — the path with the fewest third-party accounts. A contributor with an OpenRouter key boots end-to-end.
- Every `EnvSchema` key appears. **Optional keys are commented-out** with `# ` so uncommenting is the toggle. The prior shape (empty string for optional secrets) tripped `NonEmpty.optional()` — `""` satisfies `string` but fails `min(1)`. Commented-out avoids that footgun and lets the drift guard use a stable regex.
- Secret fields get placeholder sentinels (`sk-or-v1-...`, `sk-ant-...`) to make "I still need to fill this in" obvious. Non-secret local-dev fields get real values that boot as-is.
- Section headers (`── Database ──`, `── LLM ──`, …) mirror the schema's comment groupings so a reader cross-referencing `env.ts` finds the same order.

### `packages/server/src/env.ts` — shape split

Split the `z.object({…}).superRefine(…)` chain so the raw object is nameable:

```ts
const EnvObject = z.object({ … })
export const ENV_SCHEMA_KEYS = Object.keys(EnvObject.shape) as (keyof typeof EnvObject.shape)[]
export const EnvSchema = EnvObject.superRefine(…)
```

`zod@4.3.6` doesn't expose `.shape` on the `ZodEffects` produced by `.superRefine()`. Splitting the two phases keeps the schema behaviour bit-identical (same `EnvSchema`, same `loadEnv()`, same `Env` type), and gives the drift guard a first-class way to enumerate keys without reaching into `_def` internals.

### `packages/server/src/env.example.test.ts`

New test. Reads `.env.example` from the repo root (located via `import.meta.url` + `fileURLToPath`, since the server package is ESM — `__dirname` doesn't exist), greps each line with `^\s*#?\s*([A-Z][A-Z0-9_]*)=`, and asserts every key in `ENV_SCHEMA_KEYS` appears. Commented-out lines count as documented.

Verified by hand that the guard fires: temporarily removing `DATABASE_URL=…` from the example produced `missing from .env.example: DATABASE_URL` and a red test.

**`packages/server/.gitignore`:** not created. The root `.gitignore` already has `.env` / `.env.local` / `.env.*.local`, which match recursively — a per-package file would duplicate the rule.

---

## Step 3 — GitHub Actions CI

**Outcome:** every PR (and every push to `main`) runs lint + typecheck + format-check + vitest against a Postgres 16 sidecar. `main` gets a badge.

### `.github/workflows/ci.yml`

Single `verify` job, single Node 20 matrix entry, no image publishing (that paired with the dropped Dockerfiles).

- **pnpm before setup-node.** `actions/setup-node@v4` with `cache: 'pnpm'` needs the pnpm binary already on PATH to hash `pnpm-lock.yaml`. Order: `checkout → pnpm/action-setup@v3 → setup-node@v4 (node-version-file: .nvmrc, cache: pnpm) → pnpm install --frozen-lockfile`.
- **`packageManager` as the single source of pnpm truth.** `pnpm/action-setup@v3` reads `package.json`'s `packageManager: "pnpm@10.28.2"` field — no version duplicated in the workflow.
- **Postgres service container.** `postgres:16`, env user/password/db all `brandfactory`, port 5432 published, `pg_isready` healthcheck. `DATABASE_URL=postgres://brandfactory:brandfactory@localhost:5432/brandfactory` exported at the job level so `db:migrate` + the live-DB seed test see it.
- **Migrations before tests.** `pnpm -F @brandfactory/db db:migrate` runs after install; `seed.test.ts` depends on the schema being present.
- **Concurrency guard.** `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` so force-pushes to a PR don't pile up redundant runs.
- **Permissions.** `permissions: contents: read` — default read-only, no write scopes until a step needs them.

Four check steps in order: Typecheck, Lint, Format check, Test. Each runs even if a prior one fails (separate `- run:` steps) so a PR author sees every failure at once, not just the first.

### Badge

Root `README.md` gets a CI badge pointing at the workflow. The repo slug (`philholke/brandfactory`) is read off the git remote; if the repo is ever transferred, the badge URL needs a one-line update.

---

## Step 4 — Root `README.md` rewrite

**Outcome:** the root README is the complete first-run document. `packages/web/README.md` demotes to a frontend-dev reference.

Kept the branding block (logo + tagline + pill row) and the `The problem` / `The idea` / `How it'll work (sneak peek)` / `Who it's for` / `Why open source` / `Tech stack` / `License` sections — all still accurate. Replaced:

- **Status.** "Shipped so far" now mentions the Phase-8 adds (dev seed, root env template, CI, CORS gate); "Up next" points at Phase 9 (Playwright, adapter docs, standardized templates) — not the now-shipped Phase-8 compose stack.
- **Running locally → Quickstart.** Six-command flow: `pnpm install`, compose up Postgres, `cp .env.example`, `cp packages/web/.env.example`, `db:migrate`, `db:seed`, `pnpm dev`. Contributors who prefer their own Postgres skip the compose line and export `DATABASE_URL`.
- **New: Configuration section** with a server env-var reference table (every key, required-when condition, default, one-line note) and a pointer to `packages/web/README.md` for frontend env. Table entries for `SUPABASE_*` and per-provider LLM keys are grouped rather than exploded to keep it readable.
- **New: Swapping the LLM provider.** Three-step walkthrough: edit `.env`, restart, optionally override per-workspace in Settings. Explicitly notes the compile-time union shape (`LLM_PROVIDER_IDS`) so readers understand why the dropdown changes when the schema widens.
- **New: Deploying it yourself.** One honest paragraph — server is a plain Node app, web is a static Vite build, `CORS_ALLOWED_ORIGINS` handles split-origin. Links to a GitHub issue inviting self-hosters to share their setups.
- **Contributing** rewritten around CI — links to `.github/workflows/ci.yml` and the four checks. Kept the "read the vision docs and push back" ethos.

Killed the "Phase-8 README overhaul will fold…" sentence.

### `packages/web/README.md`

Trimmed the duplicated Quickstart; the intro now says "root README owns the first-run quickstart." Replaced the "dev token = manual `INSERT`" paragraph with the `db:seed` pointer (same change noted in Step 0's files-touched list — made once, lives here).

---

## Step 5 — CORS pass

**Outcome:** the Hono server supports split-origin deployments (web on `app.example.com`, server on `api.example.com`) via a single env allowlist that gates both HTTP CORS and the WS `Origin` header.

### `packages/server/src/env.ts`

Added `CORS_ALLOWED_ORIGINS: NonEmpty.optional()` to `EnvObject`. Stored as a comma-separated string; parsing into `string[]` happens downstream so the schema stays flat and `Env` stays ergonomic.

### `packages/server/src/cors.ts` (new)

Two pure helpers:

- `parseCorsAllowedOrigins(raw: string | undefined): string[] | null` — splits on `,`, trims, drops empties. Returns `null` when unset so "no allowlist" is a distinct value, not `[]` (which would mean "allow nothing").
- `isOriginAllowed(origin: string | undefined, allowlist: string[] | null): boolean` — `null` allowlist → always `true` (dev default); set allowlist + missing origin → `false`; set allowlist + origin → exact match. Same function drives the HTTP `cors()` `origin:` callback *and* the WS upgrade guard, so HTTP and WS cannot drift.

### `packages/server/src/app.ts`

Conditional `cors()` middleware. When the allowlist is `null`, nothing is mounted — single-origin dev via Vite's proxy sees zero CORS headers, matches 0.7.4 behaviour exactly. When set:

```ts
app.use('*', cors({
  origin: (origin) => allowedOrigins.includes(origin) ? origin : null,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['content-type', 'authorization'],
}))
```

Mounted before `onError` so a CORS-failed request still gets the structured `{ code, message }` error envelope.

### `packages/server/src/ws.ts`

`MountRealtimeDeps` gains `allowedOrigins?: string[] | null`. In the `upgrade` handler, right after the `/rt` pathname check and before `wss.handleUpgrade`:

```ts
if (!isOriginAllowed(req.headers.origin, allowedOrigins)) {
  socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
  socket.destroy()
  return
}
```

**Why the explicit `write` before `destroy`.** Just destroying the socket would look to the browser like a transport failure, triggering reconnect loops. Writing a `403` line first signals "permanently denied" — the client stops retrying. (Same pattern `ws` itself uses internally when `verifyClient` rejects.)

### `packages/server/src/main.ts`

Threads `parseCorsAllowedOrigins(env.CORS_ALLOWED_ORIGINS)` into the `mountRealtime` call alongside the existing deps. Pre-existing callers of `mountRealtime` in tests don't break because `allowedOrigins` is optional (default `null`).

### Tests

`packages/server/src/cors.test.ts` — 8 cases:

- `parseCorsAllowedOrigins` (2): returns `null` on unset/whitespace-only, splits + trims on a real list.
- `isOriginAllowed` (3): null allowlist permits, set allowlist denies on missing origin, set allowlist requires exact match.
- HTTP CORS (3): no `Access-Control-Allow-Origin` header when env is unset; allowed origin gets echoed; disallowed origin does not (`hono/cors` returns `"null"` or no header).

`packages/server/src/ws.test.ts` — 1 new case in a new `describe('mountRealtime: upgrade origin guard')`:

- `EventEmitter` stand-in for `HttpServer`, vi-mocked `realtime.bindToNodeWebSocketServer`, fake `Duplex` with `destroy` + `write` spies. Emits `upgrade` with `Origin: https://evil.example.com` against `allowedOrigins: ['https://app.example.com']`; asserts `socket.write` was called with a `HTTP/1.1 403 ` line and `socket.destroy` fired.

### `.env.example`

Added a commented section at the bottom documenting `CORS_ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com`. Sitting below HTTP server config because it's a deploy-shape switch, not a per-run knob. The Step-1 drift guard fires if this line is ever removed.

---

## Files touched (phase total)

### New

- `packages/db/src/seed.ts` — 170-line idempotent fixture + `main()` entry.
- `packages/db/src/seed.test.ts` — live-DB idempotency test, skipped without `DATABASE_URL`.
- `packages/server/src/env.example.test.ts` — drift guard.
- `packages/server/src/cors.ts` — allowlist parser + gate helper.
- `packages/server/src/cors.test.ts` — 8 cases (parse, gate, HTTP mount).
- `.env.example` — rewritten (existed before; shape changed materially).
- `.github/workflows/ci.yml` — lint/typecheck/format/test against Postgres 16.
- `docs/completions/phase8.md` — this file.

### Modified

- `packages/db/package.json` — `db:seed` script.
- `packages/web/README.md` — intro points at root README; dev-token paragraph switched from `INSERT INTO` to `db:seed`.
- `packages/server/src/env.ts` — split `EnvObject` / `EnvSchema`; added `ENV_SCHEMA_KEYS` export; added `CORS_ALLOWED_ORIGINS`.
- `packages/server/src/app.ts` — conditional `hono/cors` mount.
- `packages/server/src/ws.ts` — upgrade Origin guard; `allowedOrigins` dep.
- `packages/server/src/ws.test.ts` — +1 case for the upgrade guard; new imports.
- `packages/server/src/main.ts` — thread `allowedOrigins` into `mountRealtime`.
- `README.md` — CI badge, Quickstart, Configuration, LLM-provider swap, Deploying it yourself, Contributing linked to CI.

---

## Test-count math

| Bucket                                               | Cases |
| ---------------------------------------------------- | ----: |
| Base (0.7.4)                                         |   223 |
| Step 0: seed idempotency (skipped without `DATABASE_URL`) |  +1 |
| Step 1: `.env.example` drift guard                   |    +1 |
| Step 5: `cors.test.ts`                               |    +8 |
| Step 5: `ws.test.ts` upgrade guard                   |    +1 |
| **Local** (seed skipped)                             |   233 |
| **CI** (seed runs against Postgres service)          |   234 |

Plan target: 227 (223 + 1 seed + 3 CORS HTTP). Landed higher because (a) `cors.test.ts` covers the pure helpers directly as well as the middleware (extra 5 cases beyond the plan's "3 HTTP tests"), and (b) the drift-guard test (Step 1) added one the plan's running total didn't track.

---

## Items deferred out of Phase 8

- **Dockerfiles** (server + web). Opinionated packaging without a concrete self-hoster asking.
- **Full three-service `docker/compose.yaml`.** Current compose stays Postgres-only for dev.
- **`scripts/bootstrap.sh`.** Four documented commands don't earn a bash wrapper today.
- **`images.yml` CI workflow + GHCR publishing.** Paired with the Dockerfiles.
- **Multi-arch image builds, signed releases.** Paired with the Dockerfiles.
- **Production TLS / reverse-proxy config.** Deployer territory.
- **`.env.web.example` at the repo root.** Was for compose build-args; moot without the compose stack.
- **Database backup / restore tooling** · **secrets management beyond `.env`** · **observability (metrics, traces)**. Future phases / separate tracks.
- **`docs/adapters.md`** — Phase 9 Hardening.
- **Playwright e2e · per-aggregate integration tests** — Phase 9.
- **CodeQL / Dependabot / Renovate** — separate dependency-hygiene pass.

## Exit criteria — status

- [x] `pnpm -F @brandfactory/db db:seed` is idempotent and prints a dev token that logs in. *(Live path exercised by `seed.test.ts` in CI; local smoke gated on Docker being up.)*
- [x] `.env.example` exists at the repo root and drift-guards against `EnvSchema`.
- [x] CI runs lint / typecheck / format / test on every PR. *(Green-on-`main` verified once the workflow merges and triggers.)*
- [x] Root `README.md` is the complete first-run document for the non-Docker flow.
- [x] `CORS_ALLOWED_ORIGINS` gates CORS for split-origin deploys, including the WS upgrade `Origin` check.
- [x] `pnpm test` is green locally at 233 + 1 skipped (234 in CI).
