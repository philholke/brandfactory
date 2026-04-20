# `@brandfactory/web`

Vite + React 19 + Tailwind v4 + shadcn/ui frontend for BrandFactory. Split-
screen project workspace, brand editor, settings, realtime canvas.

The root [`README.md`](../../README.md) owns the first-run quickstart. This
file covers the frontend-specific setup that lives past that.

## Configuration

### `packages/web/.env`

All frontend config goes through `VITE_*` vars, inlined into the client
bundle at build time — never put secrets in this file. The full list:

| Var                      | Default  | Notes                                                                     |
| ------------------------ | -------- | ------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`      | `/api`   | Relative → goes through the Vite dev proxy; absolute → cross-origin prod. |
| `VITE_RT_URL`            | `/rt`    | WebSocket URL. Relative auto-upgrades to `ws(s)://`.                      |
| `VITE_AUTH_PROVIDER`     | `local`  | `local` (dev-token prompt) or `supabase` (magic-link).                    |
| `VITE_SUPABASE_URL`      | _(none)_ | Required iff `VITE_AUTH_PROVIDER=supabase`.                               |
| `VITE_SUPABASE_ANON_KEY` | _(none)_ | Public anon key only. The service-role key belongs in the server env.     |

### Dev proxy

`packages/web/vite.config.ts` proxies `/api` → `http://localhost:3001` and
`/rt` → `ws://localhost:3001/rt` so the browser sees a single origin in
dev. No CORS setup required. For cross-origin prod deploys, set absolute
URLs in `VITE_API_BASE_URL` / `VITE_RT_URL` and serve the Hono server
with the matching `Access-Control-Allow-Origin`.

## Auth providers

### Local (default, dev-only)

The server's `AUTH_PROVIDER=local` adapter treats the bearer token as a
user id. Every token must be a valid RFC-4122 v4 UUID that exists in the
`users` table — the adapter rejects anything else with
`InvalidTokenError`.

To get a token, run the dev seed once after migrating:

```bash
pnpm -F @brandfactory/db db:seed
```

The command prints a UUID (the demo user's id) — paste that into the
`/login` form. The token lives in `sessionStorage` (`bf_token`) so it
survives tab refreshes but not browser restarts, matching the dev-only
profile. The seed is idempotent: re-running it doesn't change the token or
create duplicates.

### Supabase

Set `VITE_AUTH_PROVIDER=supabase` + the two Supabase vars, and the
corresponding server-side Supabase env (`AUTH_PROVIDER=supabase`,
`SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, …) so the server can verify
the JWT the browser gets back from the magic-link flow. `/login` renders
an email input and sends a magic link via `signInWithOtp`. On the
redirect callback, the client hits `GET /me` with the Supabase access
token; the server validates it against the JWKS and returns the internal
user id.

Token rotation is a known gap: mid-session Supabase refreshes use the
old token until the next WS reconnect (flagged in `0.7.2` — Step-6
deferred).

## LLM providers

LLM selection is a **server-side** concern — the frontend never holds
API keys or signs provider requests. Set `LLM_PROVIDER` + the matching
key in the server's `.env` (root `.env.example`). The workspace settings
page (`/workspaces/:wsId/settings`) lets a signed-in user override the
provider + model per workspace via `PATCH /workspaces/:id/settings`; the
options come from `LLM_PROVIDER_IDS` in `@brandfactory/shared`
(`openrouter | anthropic | openai | ollama`). Widening that tuple on the
server propagates to the dropdown for free.

## Scripts

```bash
pnpm dev         # Vite dev server on :5173 (proxied to server :3001)
pnpm build       # tsc --noEmit && vite build — outputs packages/web/dist
pnpm preview     # serve the built bundle locally
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run (jsdom + RTL, 56 cases at time of writing)
pnpm test:watch  # vitest watch mode
```

## Troubleshooting

- **"No test files found" when running root `pnpm test`.** The root uses
  `vitest.workspace.ts`, not `test.projects`. If a new package lands,
  add its `vitest.config.ts` path to that file or it's silently skipped.
- **`@/*` imports fail in test.** `packages/web/vitest.config.ts` hosts
  the alias explicitly (not re-read from `vite.config.ts` in
  workspace-mode). Mirror changes in both files.
- **Supabase login redirects to the wrong origin.** The redirect URL
  sent in `signInWithOtp` is `window.location.origin`. Make sure the
  Supabase project's "Site URL" + "Additional Redirect URLs" include
  your local origin (`http://localhost:5173`).
