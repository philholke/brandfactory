# Phase 7 — Step 16 — Dev & env plumbing

Four artefacts land: `packages/web/.env.example`, a re-implemented
`scripts/dev.sh` that actually boots server + web in parallel, a
frontend-scoped `packages/web/README.md`, and a short "Running locally"
block in the root README. No production code touched — typecheck / lint
/ format / test stay green at 223 across 9 workspaces.

## Files added

- **`packages/web/.env.example`** — the five `VITE_*` vars the frontend
  reads: `VITE_API_BASE_URL` (default `/api`, proxied in dev), `VITE_RT_URL`
  (default `/rt`), `VITE_AUTH_PROVIDER` (`local | supabase`),
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Header comment explicitly
  calls out that `VITE_*` vars are inlined into the client bundle —
  no secrets. The anon key is public-safe by Supabase's design; the
  service-role key stays server-side.
- **`packages/web/README.md`** — frontend-specific dev docs. Quickstart
  (Postgres up → migrate → copy envs → `pnpm dev`), env var table, dev-
  proxy explainer, auth-provider walkthrough for both `local` and
  `supabase`, LLM-provider pointer (server-side concern), scripts
  reference, and three troubleshooting entries that came out of Step 15
  (workspace-mode / alias / Supabase redirect URL).

  The plan's Step 16 line said *"Root README.md — already a Phase-8
  task; **this phase documents the frontend-specific bits**"*. Putting
  those bits into `packages/web/README.md` keeps the root marketing-
  clean while the Phase-8 README overhaul pulls the relevant sections
  back up. This is called out at the top of both files so neither ages
  into a contradiction.

## Files modified

- **`scripts/dev.sh`** — replaced the Phase-0 placeholder (which listed
  workspace names and printed "no dev targets yet") with an actual
  parallel launcher. Uses plain `pnpm -F @brandfactory/server dev` +
  `pnpm -F @brandfactory/web dev` backgrounded; a `trap cleanup INT TERM
  EXIT` kills both children on any exit path, and `wait -n` exits as
  soon as either one dies so a crashed server doesn't leave Vite
  running with misleading 500s. Documented decision: no `concurrently`
  / `turbo` dep — plain bash + pnpm handles it in 20 lines. See
  "Decision: no parallel runner dep" below.
- **`README.md`** — the Status block now reflects "server + web
  shipped"; added a "Running locally" section (4-command quickstart
  pointing at `packages/web/README.md`). Kept intentionally minimal;
  Phase-8 owns the full rewrite.

## Decisions worth flagging

### No `concurrently` / `turbo` dep for parallel dev

The plan offered either. `concurrently` is ~80 deps (prefixes, color
codes) for a feature bash already has; `turbo` would be the first
`turbo.json` in the repo and needs a per-package task contract. Plain
bash wins: ~20 lines, zero new deps, and the `trap`/`wait -n` combo
handles the "Ctrl-C kills everything, and either-crash kills the
sibling" semantics the plan calls out. If future phases need inter-task
graphs (e.g. `db:migrate` blocking `dev`), revisit.

### Dev token = any user UUID in the DB, not a server-printed seed

The plan's Step 4 description mentioned a "dev seed script [that] prints
one at boot (see Phase 8 `scripts/bootstrap.sh`)". No such script
exists yet, and Step 16 isn't the place to add it — so
`packages/web/README.md` documents the current reality: run a one-shot
`INSERT INTO users (email) VALUES (…) RETURNING id`, paste the id into
`/login`. The existing `LocalAuthProvider` UI already placeholders
"token printed by the server on boot" — accurate once a seed script
lands; still readable today. Flagging the seed script as post-Phase-7.

### Env vars list matches the shipping code, not the plan

The plan enumerated `VITE_API_BASE_URL`, `VITE_RT_URL`,
`VITE_AUTH_PROVIDER`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
`packages/web/src/realtime/client.ts` actually reads `VITE_RT_URL` (no
other RT-specific var); `vite-env.d.ts` types all five; no others are
referenced. `.env.example` documents exactly these five and nothing
else — no placeholders for future vars that aren't yet wired.

### `.env.example` → `.env` copy, not committed `.env.local`

Kept the same pattern the root `.env.example` uses. `.env` is already
in `.gitignore` (checked); `packages/web/.env` will be too under the
existing `**/.env` rule. Quickstart in the README uses `cp
.env.example .env`, matching the server-side convention.

## Items deferred from Step 16

- **`scripts/bootstrap.sh` / seed script.** Would print a usable dev
  token on first boot. Post-Phase-7 hardening; docs note the manual
  `INSERT` fallback.
- **Playwright smoke alignment with the plan's Step 17 checklist.** The
  manual checklist in the plan still belongs in the changelog. No
  automation until Phase 9.
- **CORS headers for cross-origin prod deploys.** The frontend handles
  absolute `VITE_API_BASE_URL` / `VITE_RT_URL` correctly (typed in the
  realtime client's `toWsUrl`), but the Hono server doesn't mount a
  CORS middleware yet — dev-only single-origin is fine, the moment a
  real split deploy happens we need a CORS pass.
- **`packages/server/.env.example`.** The server reads the root
  `.env.example` via `dotenv/config`. Splitting out a server-scoped one
  is cleaner but cosmetic; not in scope.

## Verification

```
pnpm typecheck                          ✔  9/9 workspaces clean
pnpm lint                               ✔  clean
pnpm format:check                       ✔  clean
pnpm test                               ✔  223 tests (unchanged since Step 15)
bash -n scripts/dev.sh                  ✔  shell syntax clean
```

No behavioural runtime change, so no bundle / startup-time deltas to
report. The dev boot path is covered by the existing Step-17 manual
smoke check in the plan.
