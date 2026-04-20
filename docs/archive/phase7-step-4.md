# Phase 7 Completion — Step 4

**Status:** Step 4 complete. Steps 5–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 4.
**Verification (post-Step 4):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count: 167 (unchanged; Step 4 adds no logic under test). `pnpm --filter @brandfactory/web build` produces `dist/` clean.

---

## Step 4 — Auth shell

**Outcome:** `/login` renders either a Supabase magic-link form or a dev-token prompt depending on `VITE_AUTH_PROVIDER`. On success the token and userId are persisted in the Zustand `AuthStore` (backed by `sessionStorage`). On cold boot the `AuthBoundary` validates any stored token against `GET /me`, populates `userId`, and redirects to `/login` on 401. `RouterProvider` re-enters the authed tree once the store is populated.

### Surface added/changed

```
packages/web
├── package.json                          # zustand, @supabase/supabase-js added
├── src/
│   ├── vite-env.d.ts                     # new — typed ImportMetaEnv for all VITE_* vars
│   ├── auth/
│   │   ├── store.ts                      # replaced stub — Zustand store + getAuthToken()
│   │   ├── AuthBoundary.tsx              # new — boot-time token validation
│   │   └── providers/
│   │       ├── local.tsx                 # new — dev-token input form
│   │       └── supabase.tsx              # new — Supabase magic-link form
│   └── routes/
│       ├── __root.tsx                    # AuthBoundary wraps <Outlet />
│       └── login.tsx                     # provider picker, real UI replaces placeholder
```

---

### `src/vite-env.d.ts`

Adds `/// <reference types="vite/client" />` and an augmented `ImportMetaEnv` interface with all `VITE_*` variables typed as `string | undefined`. This makes `import.meta.env.VITE_AUTH_PROVIDER` etc. type-safe across the codebase — TypeScript knows each variable may be absent at runtime even if Vite inlines a value at build time.

Variables declared:

| Variable | Used by |
|----------|---------|
| `VITE_AUTH_PROVIDER` | `login.tsx` — picks `'supabase'` vs `'local'` (default) |
| `VITE_SUPABASE_URL` | `providers/supabase.tsx` — Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `providers/supabase.tsx` — Supabase anon key |
| `VITE_API_BASE_URL` | Step 5 API client |
| `VITE_RT_URL` | Step 6 realtime client |

---

### `src/auth/store.ts` — Zustand store (replaces Step 3 stub)

```ts
interface AuthState {
  token: string | null
  userId: string | null
  setAuth: (token: string, userId: string) => void
  logout: () => void
}
```

- `token` initialises from `sessionStorage.getItem('bf_token')` so it survives page refreshes.
- `userId` always starts as `null` — it's populated by `AuthBoundary` on boot (via `GET /me`) or by the auth providers on login. The router's `beforeLoad` guards only check `token`, so routes are accessible before `userId` is resolved.
- `setAuth` writes to both `sessionStorage` and the Zustand state atomically.
- `logout` clears both.
- `getAuthToken()` reads `useAuthStore.getState().token` synchronously — safe to call in TanStack Router's `beforeLoad` (outside React component tree) and, later, in the Step 5 API client's 401 interceptor.

**Why Zustand, not React Context?** `getAuthToken()` must be callable outside React (in `beforeLoad` and the API client). Zustand's `store.getState()` gives synchronous access without coupling to the React tree. A Context-based store would require a ref leak or a module-level variable anyway.

---

### `src/auth/AuthBoundary.tsx`

Wraps `<Outlet />` in the root layout. On mount:

1. Reads `token` from store state via `useAuthStore.getState().token` (lazy `useState` initializer — avoids the `react-hooks/refs` violation that would occur if a React ref were used here).
2. If no token → `ready` starts `true`, no spinner, no fetch.
3. If token present → `ready` starts `false`, spinner shows, `GET /me` fires.
4. On `200`: `setAuth(token, data.id)` populates `userId`, `setReady(true)` removes spinner.
5. On non-`200`: `logout()` clears the store, `navigate({ to: '/login' })` redirects. `ready` is never set to `true` for this path — the spinner stays until the navigation completes and `AuthBoundary` unmounts.
6. On network error (not `AbortError`): treats as transient, sets `ready = true` and lets the user proceed. The Step 5 API client's 401 interceptor will catch any subsequent failures.
7. Returns an `AbortController` cleanup so the in-flight fetch is cancelled on unmount (e.g., fast navigation away from the page).

**Why blocking (spinner) vs non-blocking?** Showing the protected page for a frame and then redirecting creates a flash-of-content that leaks data. The spinner is shown only on cold boot when a stored token needs server-side validation — in a self-hosted LAN deployment this is typically < 50 ms.

**`react-hooks/refs` rule (React 19):** React 19's ESLint rules prohibit accessing `.current` during render. The fix is to pass `useAuthStore.getState().token` directly into `useState`'s lazy initializer — the initializer runs once at component creation (before the first render's return), not during the render phase proper.

---

### `src/auth/providers/local.tsx`

Dev-only token input. Renders a single password `<Input>` with a `<Button>` that:

1. `fetch('/api/me')` with the typed token as Bearer.
2. On `200`: calls `setAuth(token, data.id)` + `navigate({ to: '/workspaces' })`.
3. On non-`200`: shows "Invalid token — check the server logs."
4. On network error: shows "Network error — is the server running?"

Button is disabled until the input is non-empty. The `onSubmit` handler uses `(e) => void handleSubmit(e)` to satisfy the `no-floating-promises` ESLint rule — the `void` operator explicitly discards the promise.

The server's local auth adapter mints a token on boot that it prints to stdout. Phase 8's `scripts/bootstrap.sh` will surface this token more explicitly; for now the placeholder text guides the user.

---

### `src/auth/providers/supabase.tsx`

Supabase magic-link provider. Active when `VITE_AUTH_PROVIDER=supabase`.

**Client initialisation:** `createClient(url, key)` is called once at module level, guarded by an `&& supabase` check, so the module is safe to import even if the env vars are absent (the provider renders an error message instead of crashing).

**`onAuthStateChange` listener** (mounted in `useEffect`):
- Fires on `SIGNED_IN` with an `access_token` — this is the callback path when the user clicks the magic link and the browser returns to the origin URL with a hash fragment.
- Validates the Supabase access token against `GET /me` (the server's Supabase auth adapter verifies the JWT against the Supabase project).
- On success: `setAuth` + `navigate({ to: '/workspaces' })`.
- Subscription is cleaned up on unmount.

**Send-link form:** `signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`. On success: shows a "check your email" confirmation. On error: shows the Supabase error message inline.

**Why `emailRedirectTo: window.location.origin`?** Supabase embeds this URL in the magic link. When the user clicks it, the browser opens the app at the origin, and `onAuthStateChange` fires with the session from the URL hash. In production this needs to match an allowed redirect URL in the Supabase project settings.

---

### `src/routes/login.tsx` — provider picker

```tsx
const provider = import.meta.env.VITE_AUTH_PROVIDER
return provider === 'supabase' ? <SupabaseAuthProvider /> : <LocalAuthProvider />
```

Reading the env var inside the component (not at module level) keeps the `VITE_AUTH_PROVIDER` value available for runtime inspection in dev tools. In practice Vite replaces `import.meta.env.*` references at build time, so the unused provider is tree-shaken in production builds. The `beforeLoad` guard (redirect to `/workspaces` if already authed) is unchanged from Step 3.

---

### `src/routes/__root.tsx` — AuthBoundary mount

`<AuthBoundary>` wraps `<Outlet />` inside the `<main>` element. This means:

- Every route (including `/login`) passes through `AuthBoundary`.
- `/login` doesn't spin because `getAuthToken()` returns `null` → `ready` starts `true`.
- Protected routes spin only on cold boot (once per session, not per navigation).

---

### Items deferred from Step 4

- **401 interceptor in the API client.** The plan notes the `AuthStore` "listens for 401 responses from the API client". The interceptor lives in Step 5's `callJson` wrapper; it will call `useAuthStore.getState().logout()` on 401 and the router's `beforeLoad` will redirect on the next navigation.
- **Token refresh.** Supabase tokens expire; `@supabase/supabase-js` handles auto-refresh via the listener. Local tokens do not expire in v1 — they are static dev JWTs.
- **Multi-tab logout.** `sessionStorage` is per-tab. Logging out in one tab does not affect others. A `storage` event listener on `localStorage` would propagate logout; deferred.
- **`scripts/bootstrap.sh`** that prints the local dev token. Phase 8 scope.
- **`packages/web/.env.example`** documenting all `VITE_*` vars. Step 16 scope.
