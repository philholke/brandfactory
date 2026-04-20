# Phase 7 Completion — Step 3

**Status:** Step 3 complete. Steps 4–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 3.
**Verification (post-Step 3):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count: 167 (unchanged; Step 3 adds no logic under test). `pnpm --filter @brandfactory/web build` produces `dist/` clean (310 kB JS, 25 kB CSS).

---

## Step 3 — TanStack Router + route skeletons

**Outcome:** `@tanstack/react-router` installed, a typed router assembled in `src/router.tsx`, all seven URL surfaces from the plan represented as placeholder route components, and `RouterProvider` mounted in `main.tsx`. Navigating to any route either shows a skeleton page (authed surface) or redirects to `/login` (the default until Step 4 fills in the real auth store).

### Surface added/changed

```
packages/web
├── package.json                              # @tanstack/react-router added to deps
├── src/
│   ├── main.tsx                              # RouterProvider replaces <App />
│   ├── App.tsx                               # deleted (replaced by root route layout)
│   ├── router.tsx                            # new — route tree + typed router export
│   ├── auth/
│   │   └── store.ts                          # new — getAuthToken / setAuthToken / clearAuthToken stubs
│   └── routes/
│       ├── __root.tsx                        # new — root layout (nav + Outlet + Toaster)
│       ├── index.tsx                         # new — / redirect (→ /login or /workspaces)
│       ├── login.tsx                         # new — /login placeholder
│       ├── workspaces.index.tsx              # new — /workspaces placeholder
│       ├── workspaces.$wsId.index.tsx        # new — /workspaces/:wsId placeholder
│       ├── workspaces.$wsId.settings.tsx     # new — /workspaces/:wsId/settings placeholder
│       ├── brands.$brandId.tsx               # new — /brands/:brandId placeholder
│       └── projects.$projectId.tsx           # new — /projects/:projectId placeholder
```

---

### `src/auth/store.ts` — auth token stub

Three thin helpers over `sessionStorage` keyed on `'bf_token'`:

- `getAuthToken()` — returns the stored JWT or `null`. Called by every route's `beforeLoad` guard.
- `setAuthToken(token)` — stores a token. Step 4's auth providers call this on successful login.
- `clearAuthToken()` — removes the token. Step 4's logout action calls this.

All three are pure functions (no React, no Zustand). `getAuthToken` is safe to call in `beforeLoad` (outside React component tree). Step 4 replaces the sessionStorage backing with a Zustand store if needed, but the call sites don't change.

---

### `src/routes/__root.tsx` — root layout

`createRootRoute` with a two-part layout:

- **`<header>`** — 48 px top bar with the BrandFactory wordmark as a `<Link to="/workspaces">`. Three placeholder slots for workspace picker, dark-mode toggle, and user menu (Steps 7–14).
- **`<main>`** — `flex flex-1 overflow-hidden` container holding `<Outlet />`. The `overflow-hidden` on `<main>` lets individual pages own their own scroll containers, which matters for the project split-screen (Step 10) where chat and canvas each scroll independently.
- **`<Toaster />`** — mounted at the root so all route components can trigger toasts without prop-drilling (sonner's `toast()` is called imperatively).

The root layout is the only place `<Toaster />` is mounted.

---

### Route files — URL surface and auth guard

All seven route files share the same pattern:

1. Import `rootRoute` from `__root.tsx` as `getParentRoute`.
2. Declare a `beforeLoad` that throws `redirect({ to: '/login' })` if `getAuthToken()` returns `null` (all protected routes) or `redirect({ to: '/workspaces' })` if `getAuthToken()` returns a value (login page only — prevents authed users from re-entering the login flow).
3. Export the route object by a name that `router.tsx` imports directly.

| File | Path | Guard |
|------|------|-------|
| `index.tsx` | `/` | → `/login` if no token, → `/workspaces` if token |
| `login.tsx` | `/login` | → `/workspaces` if already authed |
| `workspaces.index.tsx` | `/workspaces` | → `/login` if no token |
| `workspaces.$wsId.index.tsx` | `/workspaces/$wsId` | → `/login` if no token |
| `workspaces.$wsId.settings.tsx` | `/workspaces/$wsId/settings` | → `/login` if no token |
| `brands.$brandId.tsx` | `/brands/$brandId` | → `/login` if no token |
| `projects.$projectId.tsx` | `/projects/$projectId` | → `/login` if no token |

The `/` route has no `component` — it always redirects in `beforeLoad` and never renders.

#### `projects.$projectId.tsx` split-screen skeleton

The project route pre-wires the two-pane layout (`flex flex-1 overflow-hidden` with a left chat pane and a `flex-[2]` right canvas pane separated by a border) so the proportions are visible before Steps 11–12 fill in content. The `border-r` divider is the only persistent visual chrome at this stage.

---

### `src/router.tsx` — route tree + typed registration

```ts
const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  workspacesIndexRoute,
  workspaceDetailRoute,
  workspaceSettingsRoute,
  brandEditorRoute,
  projectRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
```

**Flat tree, not nested.** All routes are direct children of `rootRoute`. The alternative — nesting `workspaceDetailRoute` and `workspaceSettingsRoute` under a `workspacesRoute` layout parent — would require that layout parent to render an `<Outlet />` and would share its UI across all `/workspaces/*` pages. Since none of those pages share a visible sub-layout, flat children of root is the right shape. Nesting can be added if a shared sub-layout emerges (e.g. a workspace-level sidebar in a later step).

**`declare module` augmentation** registers the router's type with TanStack Router's ambient type registry. This enables `<Link to="...">` props to be validated against the actual route tree, `useParams()` to infer the right shape per route, and `router.navigate({ to: ... })` to be type-safe, all without any generated files.

**Why code-based, not file-based?** File-based routing via `@tanstack/router-plugin/vite` generates `routeTree.gen.ts` on first `vite` run. Without running the dev server, `pnpm typecheck` would fail on the missing generated file. Code-based routing achieves identical runtime and compile-time behaviour — the `Router` type augmentation above provides the same end-to-end type safety. Migration to file-based (swap `createRoute` → `createFileRoute`, add the Vite plugin, add `routeTree.gen.ts` to the repo) is mechanical and deferred.

---

### `src/main.tsx` — RouterProvider mount

```tsx
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
```

`App.tsx` (the Step 1 `<h1>BrandFactory</h1>` scaffold) is deleted — the root layout route takes over that role.

---

### Items deferred from Step 3

- **Vite plugin + file-based route generation.** Deferred because code-based routing satisfies all type-safety requirements without a generated file. Migrate when the route surface stabilises.
- **`@tanstack/react-query` `QueryClient`.** The plan scopes React Query to Step 5 (API client). The router has no `context` wired yet; context injection for the QueryClient lands there.
- **Route loaders / `pendingComponent`.** Prefetch data loaders and loading skeletons are Steps 5 and 14 respectively. Routes currently have no `loader`.
- **`beforeLoad` context.** The auth guard reads `sessionStorage` directly rather than pulling from a Zustand store context. Step 4 replaces this once `AuthStore` exists; the `beforeLoad` call sites stay the same.
- **`notFoundComponent`.** No 404 page yet. TanStack Router renders a blank outlet on unmatched paths; Step 14's error-boundary polish addresses this.
