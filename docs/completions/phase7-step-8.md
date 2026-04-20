# Phase 7 Completion — Step 8

**Status:** Step 8 complete. Steps 9–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 8.
**Verification (post-Step 8):** `pnpm typecheck`, `pnpm lint` — clean across 9 workspaces. Test count: 167 (unchanged; no isolated logic units added).

---

## Step 8 — Settings page

**Outcome:** `/workspaces/:wsId/settings` reads `ResolvedWorkspaceSettings` from `GET /workspaces/:id/settings`, renders a provider dropdown and free-text model input, and saves via `PATCH /workspaces/:id/settings`. A `SourceBadge` shows whether the active values come from a workspace DB row or the server env fallback.

### Surface added / replaced

```
packages/web/src/
├── api/queries/
│   └── settings.ts              # updated — added useUpdateWorkspaceSettings mutation
└── routes/
    └── workspaces.$wsId.settings.tsx   # replaced — full implementation (was placeholder)
```

---

### `src/api/queries/settings.ts`

Added `useUpdateWorkspaceSettings(workspaceId)`:

- Calls `api.workspaces[':id'].settings.$patch({ param: { id }, json: input })` with `UpdateWorkspaceSettingsInput`.
- On success, writes the returned `ResolvedWorkspaceSettings` back into the React Query cache via `queryClient.setQueryData` — no refetch needed.

---

### `src/routes/workspaces.$wsId.settings.tsx`

**`SourceBadge`** — renders "workspace setting" (accent-coloured) or "env default" (muted) depending on `ResolvedWorkspaceSettings.source`.

**Form state — draft-overlay pattern.** Local state is `useState<FormDraft | null>(null)` where `FormDraft = { provider: LLMProviderId; model: string }`. Displayed values are `draft?.provider ?? settings.llmProviderId` and `draft?.model ?? settings.llmModel`. This avoids calling `setState` inside a `useEffect` (which would trigger a lint error and an extra render cycle); the form reflects server data without local state until the user starts editing.

**Provider `Select`** — options are `LLM_PROVIDER_IDS` imported from `@brandfactory/shared`. Widening that const in shared propagates here automatically.

**Model `Input`** — free-text for v1, as specified. No provider-specific model list.

**API-key note** — a muted line below the model field: "API keys for this provider are read from the server env. DB-persisted keys are a later pass." No non-functional key inputs rendered.

**Save button** — disabled while `!isDirty`, `!provider`, `!model.trim()`, or `mutation.isPending`. `isDirty` compares draft values against the last-fetched `settings`. On success: draft cleared (form reverts to the newly cached server values), `toast.success('Settings saved')`. On error: `toast.error` with the server message if it's an `AppError`.

**Route guard** — same `beforeLoad` pattern as all authed routes.
