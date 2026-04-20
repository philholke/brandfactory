# Phase 7 Completion — Step 5

**Status:** Step 5 complete. Steps 6–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 5.
**Verification (post-Step 5):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count: 167 (unchanged; Step 5 adds no new test cases). `pnpm --filter @brandfactory/web build` produces `dist/` clean.

---

## Step 5 — Typed API client via `hono/client` + React Query

**Outcome:** a typed `api` singleton wired to `AppType`, a `callJson<T>` error wrapper, a `queryClient` singleton provided to the full component tree, and query hooks for every data surface Steps 7–12 will need.

### Surface added/changed

```
packages/web
├── package.json                          # @tanstack/react-query, hono added to deps;
│                                         #   @brandfactory/server added to devDeps (type-only)
├── src/
│   ├── main.tsx                          # QueryClientProvider wraps RouterProvider
│   └── api/
│       ├── client.ts                     # new — AppError, callJson, api singleton, queryClient
│       └── queries/
│           ├── workspaces.ts             # new — useWorkspaces, useWorkspace, useWorkspaceBrands
│           ├── brands.ts                 # new — useBrand, useBrandProjects
│           ├── projects.ts               # new — useProjectDetail, useProjectBlocks, useProjectMessages
│           └── settings.ts              # new — useWorkspaceSettings

packages/server
└── src/routes/blobs.ts                  # Uint8Array cast: Uint8Array<ArrayBuffer> (cross-env lib fix)
```

---

### `packages/web/src/api/client.ts`

Three exports: `AppError`, `callJson<T>`, `api`, and `queryClient`.

#### `AppError`

```ts
class AppError extends Error {
  readonly code: string   // server's onError { code } field
  readonly status: number // HTTP status
}
```

Thrown by `callJson` on any non-2xx response. Downstream callers can `catch (e)` and `e instanceof AppError` to handle specific codes (e.g., `AGENT_BUSY` in `useAgentChat`).

#### `callJson<T>(res: Response): Promise<T>`

Wraps hono/client responses:
- `res.ok` → `res.json() as Promise<T>`
- `!res.ok` → attempts to parse `{ code, message }` from the JSON body, falls back to `res.statusText` / `'UNKNOWN'` if the body isn't JSON, then throws `AppError`.
- **401 side-effect:** on 401, calls `useAuthStore.getState().logout()` before throwing so the auth store clears immediately. The router's `beforeLoad` guard redirects to `/login` on the next navigation.

The return type `T` is caller-supplied because hono/client's `ClientResponse<T>` already infers it per-route — `callJson` just enforces the error path.

#### `api` singleton

```ts
export const api = hc<AppType>(
  import.meta.env.VITE_API_BASE_URL ?? '/api',
  { headers: (): Record<string, string> => token ? { authorization: `Bearer ${token}` } : {} },
)
```

`hc<AppType>` types every route call against the server's `AppType = ReturnType<typeof createApp>`. Changing a route signature in the server breaks the frontend typecheck immediately.

**Base URL:** defaults to `/api` (proxied by Vite's dev server to `http://localhost:3001`, stripping the `/api` prefix). In production, set `VITE_API_BASE_URL` to the absolute backend URL.

**Headers:** the callback reads `getAuthToken()` on each call — no need to re-create the client after login/logout.

**Type-only server dep:** `@brandfactory/server` is in `devDependencies` with `import type { AppType }`. Vite erases the type import entirely from the bundle; no server code reaches the browser.

**Cross-environment `blobs.ts` fix:** importing `@brandfactory/server` types causes the web's TypeScript (with `lib: ["DOM"]`) to process `blobs.ts`, where `new Response(bytes, ...)` was typed as `Uint8Array<ArrayBufferLike>`. The DOM lib's `BufferSource` only accepts `Uint8Array<ArrayBuffer>` (the narrower generic). Fix: cast `bytes as Uint8Array<ArrayBuffer>` — a no-op at runtime, satisfies both server (`lib: ["ES2022"]`) and web (`lib: ["DOM"]`) contexts.

#### `queryClient` singleton

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof AppError && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})
```

- `staleTime: 30s` — queries are considered fresh for 30 seconds; background refetch on focus/mount only after that. Appropriate for self-hosted single-user.
- `retry` — no retries on 4xx (user/auth errors); up to 2 retries on 5xx / network errors.

Exported from `client.ts` so both `main.tsx` (for `QueryClientProvider`) and route loaders (Steps 7–12) can import it directly without prop-drilling through router context.

---

### Query hooks — `src/api/queries/`

All hooks follow the same pattern: a `queryKey` factory for invalidation, an `enabled` guard on the ID param, and a `queryFn` that calls `callJson<T>` on the hono client response.

#### `workspaces.ts`

| Export | Route | Type |
|--------|-------|------|
| `workspaceKeys` | — | key factory |
| `useWorkspaces()` | `GET /workspaces` | `Workspace[]` |
| `useWorkspace(id)` | `GET /workspaces/:id` | `Workspace` |
| `useWorkspaceBrands(wsId)` | `GET /workspaces/:workspaceId/brands` | `Brand[]` |

#### `brands.ts`

| Export | Route | Type |
|--------|-------|------|
| `brandKeys` | — | key factory |
| `useBrand(id)` | `GET /brands/:id` | `BrandWithSections` |
| `useBrandProjects(brandId)` | `GET /brands/:brandId/projects` | `Project[]` |

#### `projects.ts`

| Export | Route | Type |
|--------|-------|------|
| `projectKeys` | — | key factory |
| `useProjectDetail(id)` | `GET /projects/:id` | `ProjectDetail` |
| `useProjectBlocks(id)` | `GET /projects/:id/canvas/blocks` | `CanvasBlock[]` |
| `useProjectMessages(id, limit?)` | `GET /projects/:id/messages` | `AgentMessage[]` |

`useProjectDetail` is the primary hook for the split-screen route loader (Step 10) — it returns the widened `ProjectDetail` shape including blocks, shortlist, messages, and brand in one round-trip.

`useProjectBlocks` and `useProjectMessages` are used by `applyAgentEvent` (Step 13) to invalidate the sub-caches when realtime events arrive — they share keys with the sub-arrays of `useProjectDetail` via `projectKeys.blocks(id)` / `projectKeys.messages(id)`.

#### `settings.ts`

| Export | Route | Type |
|--------|-------|------|
| `settingsKeys` | — | key factory |
| `useWorkspaceSettings(wsId)` | `GET /workspaces/:id/settings` | `ResolvedWorkspaceSettings` |

---

### `src/main.tsx` — QueryClientProvider mount

```tsx
<StrictMode>
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
</StrictMode>
```

`QueryClientProvider` is the outermost provider so every component in the tree (including route components, error boundaries, and the `AuthBoundary`) can call `useQuery` / `useMutation` / `useQueryClient`.

---

### Items deferred from Step 5

- **Mutation hooks (`useMutation`).** Mutations (create workspace, create brand, PATCH settings, canvas ops) are written inline in the components that need them (Steps 7–12), using `useMutation` from `@tanstack/react-query` and the raw `api.*.$post()` / `api.*.$patch()` calls with `callJson`. Centralizing them in `queries/` is optional polish for a post-Phase-7 pass.
- **Router context injection for loaders.** The `queryClient` is exported as a singleton; route loaders import it directly. Injecting it via `router.context` (the TanStack Router pattern for SSR-safe loaders) is deferred — the SPA-only target doesn't require it.
- **`@tanstack/react-query` devtools.** `ReactQueryDevtools` is a useful debug overlay. Add in Step 16's dev-env pass.
- **Query key co-location with mutations.** Steps 7–12 will need to `queryClient.invalidateQueries({ queryKey: workspaceKeys.brands(wsId) })` after mutations. The key factories exported here make that straightforward without coupling.
