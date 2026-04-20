# Phase 8 — Dev onboarding & CI (scoped-down)

Goal: a contributor goes from `git clone` to a running BrandFactory
locally with minimal friction, and PRs on GitHub are automatically
linted, type-checked, and tested. The feature surface doesn't move; the
*reproducibility* surface does — but only the parts that benefit us
whether or not anyone ever forks the repo.

## Scope decision (2026-04-20)

The original Phase-8 plan bundled dev-onboarding work (seed script,
root `.env.example`, README rewrite, CI, CORS) together with a full
self-host deploy story (server + web Dockerfiles, three-service
compose stack, `bootstrap.sh`). We're **dropping the deploy half**
and keeping the onboarding + CI half. Rationale:

- **"Self-hosted, no lock-in"** (vision.md) means the code must not
  block anyone from hosting; it doesn't require us to ship the recipe.
  Self-hosters have strong, divergent opinions (k8s, Nomad, Coolify,
  Dokku, bare Node + systemd) and an opinionated compose stack is a
  maintenance magnet — "why doesn't your compose work with my reverse
  proxy" issues — without a real self-hoster asking for it yet.
- **Dev onboarding, CI, and CORS pay off regardless.** The seed script
  removes a 30-minute onboarding tax every contributor hits. CI
  protects `main` from regressions and is cheap. CORS is a product
  gap in the server, not scaffolding.
- **Punt Docker/compose/bootstrap.** When a real self-hoster shows up
  with a concrete use case, their first issue will shape the tooling
  better than guessing now.

Kept: Steps 0, 1, 6 (renumbered 3), 7 (renumbered 4), 8 (renumbered
5). Dropped: Steps 2, 3, 4, 5 (Dockerfiles + compose + bootstrap.sh)
— see "Explicitly dropped" section below.

Starting point: 0.7.4 (post-Phase-7). Server + web ship end-to-end, 223
vitest cases green, but the dev loop still requires a manual `INSERT
INTO users` to mint a dev token, there's no root `.env.example`, no
CI, and the root `README.md` carries a Phase-8 placeholder that points
at `packages/web/README.md` for the real instructions.

Scaffolding reference: [./scaffolding-plan.md](./scaffolding-plan.md)
§ Phase 8 (note: the scaffolding plan is broader than what we're
executing here). Phase-7 deferred items that Phase 8 **does** pick up:
dev-seed script (0.7.4 notes), root README rewrite (0.7.4 notes), CORS
for split-origin prod deploys (0.7.4 notes). Phase-7 deferred items
that Phase 8 does **not** pick up: optimistic canvas mutations,
server-side `position` rebalance, `Cmd-K` palette, Playwright e2e
(that's Phase 9). Phase 9 hardening items (error-taxonomy polish,
correlation-id propagation, per-aggregate integration tests,
`docs/adapters.md`) ride separately.

---

## What's already in place (don't rebuild)

- **`docker/compose.yaml`** — single-service dev compose for Postgres
  16 on :5432, named volume, healthcheck. Stays Postgres-only for
  Phase 8 (full-stack widening is dropped; see Steps 2–5).
- **`scripts/dev.sh`** — parallel launcher for server + web with
  `trap`-based cleanup (shipped 0.7.4). Stays as-is. `pnpm dev` wires
  to it. (`scripts/bootstrap.sh` was originally planned here; dropped
  with Steps 2–5.)
- **`packages/server/src/env.ts`** — single env schema with per-adapter
  validation via `superRefine`. The `.env.example` in Step 1 is
  generated **by reading this schema**, not hand-maintained; drift is
  impossible by construction.
- **`packages/web/.env.example`** — the five `VITE_*` vars the
  frontend reads (shipped 0.7.4). Stays; the root `.env.example` is
  for the *server* surface only and cross-references it.
- **Typecheck + lint + format + test scripts at the root** — all nine
  workspaces honour `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm test`. CI in Step 3 just runs these four commands; no
  per-package glue needed.
- **`packages/db`** — migrations live under `packages/db/migrations/`
  and apply via `pnpm -F @brandfactory/db db:migrate`. The seed script
  in Step 0 is a new sibling command, not a migration.

## Non-goals (explicitly deferred)

- **Any shipped deploy recipe.** No Dockerfiles, no full-stack compose,
  no k8s, no Fly/Render/Railway templates, no TLS/reverse-proxy
  config. See "Scope decision" above and the dropped-steps section for
  the rationale. The README will say: server is a Node app needing
  Postgres + env vars; web is a static Vite build; self-hosters
  choose their own packaging.
- **Image publishing.** Paired with the dropped Dockerfiles; no GHCR
  pushes in CI, no tagging, no release automation.
- **Secrets management beyond `.env`.** No Vault, no SOPS, no Doppler.
- **Playwright e2e.** Phase 9. Phase 8 CI stops at vitest.
- **CodeQL / Dependabot / Renovate.** Dependency hygiene is a
  separate conversation.

---

## Step 0 — Seed script + dev-token flow

**Outcome:** a fresh contributor runs one command and gets a printable
dev bearer token bound to a real row in `users`. Closes the "manual
`INSERT INTO users`" gap called out in 0.7.4 and makes the
`scripts/bootstrap.sh` flow (Step 5) possible.

- **`packages/db/src/seed.ts`** (new) — idempotent seed. Inserts (or
  `ON CONFLICT DO NOTHING`) a single demo user
  (`demo@brandfactory.local`, id minted deterministically from a hard-
  coded UUID so reruns stay stable), one workspace (`"Demo Workspace"`),
  one brand (`"Acme Coffee"`) with three seed `brand_sections`
  (voice / audience / values — short placeholders), one freeform
  project attached to that brand. The assistant's first-run should feel
  populated, not empty.
- **`packages/db/package.json`** — new `db:seed` script running
  `tsx src/seed.ts`. Reads `DATABASE_URL` from process env, same as
  migrations. Exits 0 on success, non-zero on DB error.
- **Dev-token format decision.** The `local` auth adapter already
  accepts any valid UUID that exists in `users` as a bearer. No new
  token format needed — the seed script just `console.log`s the demo
  user's id as the "dev token." Supabase-provider users generate their
  own tokens through the magic-link flow; the seed doesn't touch auth.
- **`packages/web/README.md`** — replace the "one-shot `INSERT`
  fallback" paragraph (from 0.7.4) with a one-line pointer to
  `pnpm -F @brandfactory/db db:seed` + the printed id.
- **Test.** One vitest case asserting `seed()` is idempotent — run it
  twice in sequence, assert user/workspace/brand counts are 1 each.
  No new integration test suite; this piggybacks on
  `@brandfactory/db`'s existing vitest against the dev Postgres.

### Files touched in Step 0

- `packages/db/src/seed.ts` (new)
- `packages/db/src/seed.test.ts` (new — one idempotency case)
- `packages/db/package.json` — add `db:seed`
- `packages/web/README.md` — update the dev-token paragraph

**Smoke check:** `pnpm -F @brandfactory/db db:migrate &&
pnpm -F @brandfactory/db db:seed` prints a UUID, that UUID works as a
bearer in the `/login` page, and re-running `db:seed` produces no
duplicates and no errors.

---

## Step 1 — Root `.env.example`

**Outcome:** one copy-pasteable file at the repo root enumerating
every *server* env var with a one-line comment explaining what it does
and which adapter toggle it's gated on. Cross-references
`packages/web/.env.example` for the frontend-side vars.

- **Source of truth = `EnvSchema`.** The `.env.example` is organised
  in the same order as the schema, with section headers matching the
  schema's comment groupings (Database, Auth, Storage, Realtime, LLM,
  Blob local-disk config, Supabase, LLM keys, HTTP server). Every key
  in the schema appears; optional keys are commented-out with a
  `# ` prefix so uncommenting them is the toggle.
- **Minimal viable defaults.** The shipped file boots a
  `local` + `local-disk` + `native-ws` + `openrouter` stack — the path
  that exercises the most code with the fewest third-party accounts.
  A contributor with an OpenRouter key can run end-to-end in five
  minutes. Anthropic / OpenAI / Ollama / Supabase are commented-out
  alternatives with inline notes.
- **Safe-to-commit posture.** `.env.example` ships real example values
  for non-secret fields (`DATABASE_URL=postgres://...@localhost:5432/...`,
  `BLOB_LOCAL_DISK_ROOT=./.blobs`) and placeholder sentinels
  (`ANTHROPIC_API_KEY=sk-ant-...`) for secret fields. The existing
  root `.gitignore` already ignores `.env` — Step 1 verifies this and
  adds `.env` to `packages/server/.gitignore` if missing.
- **Drift guard.** A new tiny vitest in `@brandfactory/server`
  (`env.example.test.ts`) parses `.env.example` and asserts every key
  listed in `EnvSchema` is either present or commented-out. Breaks the
  build the moment someone widens the schema without updating the
  example. ~30 lines.

### Files touched in Step 1

- `.env.example` (new at repo root)
- `.gitignore` — audit; add root-level `.env` if not already present
- `packages/server/.gitignore` — add `.env` if missing
- `packages/server/src/env.example.test.ts` (new)

**Smoke check:** `cp .env.example .env` + `pnpm -F @brandfactory/server
dev` boots without errors after the contributor sets
`OPENROUTER_API_KEY`. `pnpm test` stays green and the new drift guard
actually fires when a schema key is removed from `.env.example`
(verify by hand once).

---

## Steps 2–5 — DROPPED (Dockerfiles, compose stack, bootstrap.sh)

Originally scoped: server Dockerfile (Step 2), web Dockerfile +
Caddyfile (Step 3), full three-service `docker/compose.yaml` with a
`migrate` init service + named blob volume + `.env.web` build args
(Step 4), and `scripts/bootstrap.sh` for a non-Docker one-command
first-run (Step 5).

**Why dropped:**

- **No concrete self-hoster yet.** We'd be guessing at the shape. A
  compose stack is opinionated (Caddy vs nginx, single-origin proxy
  vs split, named volume layout, `VITE_*` rebuild semantics) and each
  choice is a support surface.
- **`bootstrap.sh` leans on the dropped compose file.** Its Postgres
  step is `docker compose -f docker/compose.yaml up -d postgres`. The
  existing `docker/compose.yaml` already boots just Postgres for dev
  (unchanged from Phase-7); contributors can run it directly. Wrapping
  four shell commands in a script doesn't earn its maintenance cost.
- **Dev server launcher already exists.** `scripts/dev.sh` (shipped
  0.7.4) handles the parallel server+web boot with trap cleanup. The
  README can document the handful of first-run steps explicitly.
- **Images in CI without a compose stack.** Step 6's `images.yml`
  assumed Dockerfiles existed. With Steps 2–3 dropped, the CI
  workflow narrows to lint/typecheck/format/test only. Image publishing
  comes back when Dockerfiles do.

**When to revisit:** first real self-host request, or when we decide
to publish images for a managed-hosting trial. At that point the
scope is clearer: what proxy, what TLS story, what volume layout,
what the operator actually wants.

**What this leaves for contributors today:** `docker/compose.yaml`
already boots Postgres. `pnpm -F @brandfactory/db db:migrate` applies
schema. `pnpm -F @brandfactory/db db:seed` (Step 0) prints a dev
token. `pnpm dev` (via `scripts/dev.sh`) boots server + web. Four
commands after `pnpm install`, documented in the root README (Step
4). Not one command, but not an onboarding crisis either.

---

## Step 3 — GitHub Actions CI

(Formerly Step 6. No `images.yml` — that depended on Steps 2–3.)

**Outcome:** every PR runs lint, typecheck, format-check, and test.
`main` stays green.

- **`.github/workflows/ci.yml`** — triggered on `pull_request` and
  `push` to `main`. Single job `verify`:
  1. Checkout.
  2. Setup Node 20 via `actions/setup-node@v4` with `cache: 'pnpm'`.
  3. Setup pnpm via `pnpm/action-setup@v3` (version from
     `package.json`'s `packageManager` field).
  4. `pnpm install --frozen-lockfile`.
  5. Postgres service container (`postgres:16`) for
     `@brandfactory/db`'s live-DB vitest cases. `DATABASE_URL` env var
     set to the service address.
  6. `pnpm -F @brandfactory/db db:migrate` to set up the schema.
  7. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.
  8. Node 20 is the only matrix entry — no 18 fallback; `.nvmrc`
     pins 20.
- **No `images.yml`.** Image publishing was originally scoped in this
  step but depended on the dropped server + web Dockerfiles. Returns
  when the Dockerfiles do.
- **Concurrency.** `concurrency: { group: ci-${{ github.ref }},
  cancel-in-progress: true }` so force-pushes to a PR don't pile up.
- **Permissions.** Default read-only.

### Files touched in Step 3

- `.github/workflows/ci.yml` (new)
- `README.md` — status badge linking to `ci.yml`

**Smoke check:** a throwaway PR against `main` turns the CI check green
in < 5 minutes. Intentionally breaking typecheck on a branch turns it
red.

---

## Step 4 — Root `README.md` rewrite

(Formerly Step 7. Rewritten around the no-Docker-yet onboarding flow.)

**Outcome:** the root README is the complete first-run document.
`packages/web/README.md` demotes to a frontend-dev reference that the
root links to for deep details.

- **Target structure** (keep the existing top-of-file branding intact,
  rewrite the body):
  1. Elevator pitch (2 sentences) + vision link.
  2. Status block pointing at the changelog.
  3. **Quickstart** — the four-command flow:
     ```
     pnpm install
     docker compose -f docker/compose.yaml up -d   # Postgres only
     pnpm -F @brandfactory/db db:migrate
     pnpm -F @brandfactory/db db:seed              # prints dev token
     pnpm dev
     ```
     Prerequisites: Node 20, pnpm, Docker (for Postgres). Contributors
     who prefer their own Postgres skip the compose line and set
     `DATABASE_URL` themselves.
  4. Env-var reference table — split into "server (`.env`)" and
     "frontend (`packages/web/.env`)". One row per var with type +
     description + default; link out to `packages/web/README.md` for
     the magic-link / Supabase flow.
  5. **Swapping the LLM provider** — short walkthrough of editing
     `LLM_PROVIDER` + `LLM_MODEL` + the per-provider key, restarting,
     and flipping the workspace-level override in the Settings UI.
  6. **Deploying it yourself** — one honest paragraph: "We don't ship
     a deploy recipe yet. The server is a plain Node app (`node
     dist/main.js` after a `tsc` build) needing Postgres 16 + the env
     vars in `.env.example`; the web is a static Vite build. For
     split-origin deploys see `CORS_ALLOWED_ORIGINS` (Step 5)." Link
     to a GitHub Discussion / issue inviting self-hosters to share
     their setups.
  7. **Project status / roadmap** — Phase 8 scope explicitly narrowed;
     full deploy tooling deferred.
  8. **Contributing** — link to CI, commit-style convention, PR shape.
  9. **License.**
- **Kill the "Phase-8 README overhaul will fold…" sentence.** That
  was the Phase-7 self-aware placeholder; it's no longer true.

### Files touched in Step 4

- `README.md` — full-body rewrite (branding / logo block stays)
- `packages/web/README.md` — trim to frontend-dev content (remove the
  "dev token = manual INSERT" paragraph per Step 0)

**Smoke check:** a fresh reader who's never seen the repo can follow
the root README top-to-bottom and end up with a working
`localhost:5173` in under 10 minutes, without opening any other doc.

---

## Step 5 — CORS pass

(Formerly Step 8. Unchanged in intent; readme-wiring updated to point
at Step 4's "Deploying it yourself" section.)

**Outcome:** the Hono server supports split-origin deployments (web on
`app.example.com`, server on `api.example.com`) via a configurable
allowlist. The single-origin dev default is unaffected.

- **`CORS_ALLOWED_ORIGINS`** env var, optional, comma-separated. When
  unset, CORS is disabled (dev + local-run is same-origin via Vite's
  proxy). When set, the server mounts `hono/cors` with `origin:
  (req) => allowlist.includes(req.header('origin')) ? origin : null`,
  `credentials: true`, `allowMethods: ['GET', 'POST', 'PATCH',
  'DELETE', 'OPTIONS']`, `allowHeaders: ['content-type',
  'authorization']`.
- **WebSocket upgrade** respects `Origin` header too — a ~10-line
  guard in `ws.ts` that rejects `101` upgrades from origins not in
  the allowlist when the allowlist is set. Closes the obvious hole
  where CORS-locked HTTP but wide-open WS would still let a
  cross-origin page open `/rt`.
- **Tests.** Three new vitest cases in `packages/server`:
  (1) no CORS header when env is unset; (2) allowed origin gets the
  header; (3) disallowed origin does not. Plus one WS upgrade
  rejection case. Existing 223 test count grows by 4.
- **README wiring.** Step 4's README links to this as the knob to
  flip for split-origin deploys.

### Files touched in Step 5

- `packages/server/src/env.ts` — add `CORS_ALLOWED_ORIGINS` (optional
  string; parsed into `string[]` downstream)
- `packages/server/src/app.ts` — conditional `cors()` middleware
- `packages/server/src/ws.ts` — origin guard
- `packages/server/src/app.test.ts` + `ws.test.ts` — four new cases
- `.env.example` — documented line (commented-out)

**Smoke check:** with `CORS_ALLOWED_ORIGINS=https://app.example.com`
set, `curl -H 'Origin: https://app.example.com' -i
http://localhost:3001/health` returns the
`Access-Control-Allow-Origin` header; the same curl with a different
origin does not.

---

## Step 6 — Verification

```
# Onboarding path (no Docker, Postgres via dev compose)
pnpm install
docker compose -f docker/compose.yaml up -d        # Postgres
pnpm -F @brandfactory/db db:migrate
pnpm -F @brandfactory/db db:seed                   # prints dev token
pnpm dev
# → open http://localhost:5173, paste dev token into /login, send a message

# CI path
# — throwaway branch, trivial PR, green check within ~5 minutes
```

```
pnpm typecheck                          ✔  9/9 workspaces clean
pnpm lint                               ✔  clean
pnpm format:check                       ✔  clean
pnpm test                               ✔  227 tests (+4 CORS; was 223)
```

---

## Items explicitly deferred out of Phase 8

Picked up later, when either a concrete self-hoster surfaces or we
decide to publish images ourselves:

- **Server + web Dockerfiles** (was Steps 2–3). No real self-host
  request yet; shipping opinionated Dockerfiles is a maintenance
  magnet without one.
- **Full three-service `docker/compose.yaml`** (was Step 4). Current
  `docker/compose.yaml` stays Postgres-only.
- **`scripts/bootstrap.sh`** (was Step 5). Four documented commands
  don't earn a bash wrapper today. Returns if onboarding feedback
  says otherwise.
- **`images.yml` CI workflow + GHCR publishing.** Paired with the
  Dockerfiles above.
- **Multi-arch image builds** (linux/arm64).
- **Signed image releases / version tags.**
- **Production TLS / reverse-proxy config** (Caddy, Cloudflare, etc.).
- **`.env.web.example` at the repo root.** Was for compose build-args;
  moot without the compose stack.

Deferred regardless of the scope cut (belong to later phases or
separate tracks):

- **Database backup / restore tooling.** `pg_dump` is fine for now.
- **Secrets management beyond `.env`.** Vault / SOPS / Doppler is a
  user concern.
- **Observability** (metrics, traces, log shipping). Deployer territory.
- **`docs/adapters.md`** — Phase 9 `Hardening`.
- **Playwright e2e** — Phase 9.
- **Integration tests per aggregate** — Phase 9.
- **CodeQL / Dependabot / Renovate** — separate dependency-hygiene pass.
- **Release notes automation** — post-scaffolding.

## Phase 8 exit criteria

- [ ] `pnpm -F @brandfactory/db db:seed` is idempotent and prints a
      dev token that logs in.
- [ ] `.env.example` exists at the repo root and drift-guards against
      `EnvSchema`.
- [ ] CI runs lint / typecheck / format / test on every PR and stays
      green on `main`.
- [ ] Root `README.md` is the complete first-run document for the
      non-Docker flow.
- [ ] `CORS_ALLOWED_ORIGINS` env var gates CORS for split-origin
      deploys (and gates the WS upgrade Origin check).
- [ ] `pnpm test` passes at 227 (223 + 1 seed + 3 CORS HTTP; the WS
      origin case replaces an existing upgrade test).
