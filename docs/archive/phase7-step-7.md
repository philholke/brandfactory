# Phase 7 Completion — Step 7

**Status:** Step 7 complete. Steps 8–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 7.
**Verification (post-Step 7):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count: 167 (unchanged; new UI components have no isolated logic units).

---

## Step 7 — Workspaces + brands list screens + workspace picker

**Outcome:** a user can log in, land on `/workspaces`, create a workspace, navigate into it, and create a brand. The top-nav workspace picker lets them switch workspaces from anywhere.

### Surface added / replaced

```
packages/web/src/
├── lib/
│   └── last-workspace.ts           # new — localStorage helpers
├── api/queries/
│   └── workspaces.ts               # updated — useWorkspaces accepts { enabled? } option
└── routes/
    ├── __root.tsx                   # updated — WorkspacePicker in header
    ├── workspaces.index.tsx         # replaced — full workspace list page
    └── workspaces.$wsId.index.tsx  # replaced — full brand list page
```

---

### `src/lib/last-workspace.ts`

`getLastWorkspaceId()` / `setLastWorkspaceId(id)` read/write `bf_last_workspace` in `localStorage`. Reads return `null` on failure (private-mode); writes swallow errors silently.

---

### `src/routes/workspaces.index.tsx` — Workspaces list page

- **`NewWorkspaceDialog`** — Dialog with a name `Input`. `useMutation` calls `api.workspaces.$post`; on success invalidates `workspaceKeys.all()`, saves the new ID to localStorage via `setLastWorkspaceId`, and navigates to `/workspaces/$wsId`. Errors surface via `toast.error`.
- **`WorkspaceCard`** — button that saves last-workspace ID and navigates.
- **`WorkspacesPage`** — `useWorkspaces()` with loading / error / empty / grid states.
- Route guard: `beforeLoad` redirects to `/login` if no auth token.

---

### `src/routes/workspaces.$wsId.index.tsx` — Brand list page

- **`NewBrandDialog`** — Dialog with name + optional description inputs. Mutation calls `api.workspaces[':workspaceId'].brands.$post`; on success invalidates `workspaceKeys.brands(wsId)` and navigates to `/brands/$brandId`.
- **`BrandCard`** — button that navigates to `/brands/$brandId`. Shows description (line-clamped) and creation date.
- **`WorkspaceDetailPage`** — fetches `useWorkspace(wsId)` (name in header) + `useWorkspaceBrands(wsId)` (grid). `useEffect` saves `wsId` to localStorage on mount/change. Back link to `/workspaces`. Settings link to `/workspaces/$wsId/settings`.
- Route guard: same `beforeLoad` auth check.

---

### `src/routes/__root.tsx` — WorkspacePicker in header

`WorkspacePicker` reads `token` from `useAuthStore`. When absent (logged-out / login page) it renders nothing — no query fires, no 401. When present it calls `useWorkspaces({ enabled: true })` and renders a shadcn `Select` (width `w-48`) in the header right side.

- `value`: `getLastWorkspaceId() ?? ''` — empty string shows the "Select workspace" placeholder.
- `onValueChange`: `setLastWorkspaceId(id)` + `navigate` to the new workspace detail route.

The `WorkspacePicker` replaces the Step-7-14 placeholder comment.

---

### Notes

- `autoFocus` was removed from both dialog name inputs to satisfy `jsx-a11y/no-autofocus`. Dialogs trap focus automatically via Radix, so the input still receives focus on open without the prop.
- `useWorkspaces({ enabled: !!token })` prevents a 401 + inadvertent `logout()` call when `WorkspacePicker` mounts on the login page before auth is established.
