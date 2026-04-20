# Phase 7 Completion — Step 10

**Status:** Step 10 complete. Steps 11–17 pending at time of writing (Step 11 landed immediately after; see [phase7-step-11.md](./phase7-step-11.md)).
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 10.
**Verification (post-Step 10):** `pnpm --filter @brandfactory/web typecheck`, `pnpm lint` — clean. Test count: 167 (unchanged; layout components are structural, no isolated logic units added).

---

## Step 10 — Project split-screen layout

**Outcome:** `/projects/:projectId` fetches `ProjectDetail` via `useProjectDetail`, subscribes to the `project:<id>` realtime channel via `useProjectStream`, and renders a two-pane layout: a top bar (brand → project breadcrumb) above a draggable-divider split with a chat-pane placeholder on the left and a canvas-pane placeholder on the right. The canvas pane already wires the client-side shortlist filter over `data.blocks` / `data.shortlistBlockIds`, so toggling "Shortlist" works before the block renderers land in Step 12.

### Surface added / replaced

```
packages/web/src/
├── components/project/
│   ├── TopBar.tsx                  # new — brand/project breadcrumb
│   ├── ShortlistToggle.tsx         # new — "All blocks" / "Shortlist (N)" pill
│   └── SplitScreen.tsx             # new — draggable-divider two-pane layout
└── routes/
    └── projects.$projectId.tsx     # replaced — full implementation (was placeholder)
```

No new deps, no new tests.

---

### `src/components/project/TopBar.tsx`

Renders `{brand.name} / {project.name}`. The brand name is a typed `Link` to `/brands/$brandId` (TanStack Router gives us compile-time param checking); project name is plain text since this route is the project. Consumes `Project` + `BrandWithSections` from `@brandfactory/shared` directly — no intermediate DTO.

### `src/components/project/ShortlistToggle.tsx`

Inline pill with two tab buttons, `role="tablist"` / `aria-selected` for SR correctness (shadcn primitives aren't a fit — this is a two-option radio, not a menu). Exports `ShortlistMode = 'all' | 'shortlist'` used by the canvas pane. Shortlist count is rendered in the label (`Shortlist (N)`) so the user sees the size without toggling.

### `src/components/project/SplitScreen.tsx`

Hand-rolled draggable split pane, ~55 lines. Decision: **not vaul** — vaul is drawer-shaped, not split-pane-shaped, and the actual behaviour we want (pointer-capture drag, clamp to a range, persist nothing for v1) is trivial to write directly.

- State: `leftPct` (percentage, defaults to 36 for a ~1:2 ratio; clamps 25–65%).
- Refs: `containerRef` for measuring width, `draggingRef` so `onPointerMove` is a no-op unless we're in a drag.
- `setPointerCapture` on pointer-down gives us reliable drag semantics even when the cursor leaves the handle; `releasePointerCapture` in `onPointerUp` / `onPointerCancel` resets. Guarded with `hasPointerCapture` so StrictMode double-fire or a missed pointer-down doesn't throw.
- `flexBasis: ${leftPct}%` on the left column, `flex-1` on the right — right side absorbs the remainder regardless of window width.
- Divider is a 1px `bg-border` strip with `cursor-col-resize` and a hover tint; ARIA `role="separator"` + `aria-orientation="vertical"` for screen readers.
- Width is **not** persisted to localStorage in v1. Opt-in later if it matters; for a single-screen app it's fine to re-centre each load.

### `src/routes/projects.$projectId.tsx`

**Data loading.** `useProjectDetail(projectId)` via the existing hook — no TanStack Router `loader` used, consistent with the brand editor pattern from Step 9. Route-loader prefetch is a future refinement (plan mentions it; hook-in-component is simpler and identical in behaviour once the `QueryClient` is primed).

**Realtime subscription.** `useProjectStream(projectId)` mounts alongside the query. The hook handles both the subscribe lifecycle and the cache-sync side effects; this route doesn't need to know about `AgentEvent`.

**States.** Loading → centred muted "Loading project…"; error or missing → centred destructive message with `error.message`. Golden path renders `<TopBar>` + `<SplitScreen>`.

**`CanvasPane` (internal to the route for now).** Already implements the Step-10 shortlist filter:

- `shortlistSet = useMemo(() => new Set(shortlistBlockIds), …)` so the filter doesn't re-allocate on every render.
- `visible = mode === 'shortlist' ? blocks.filter((b) => shortlistSet.has(b.id)) : blocks`.
- Empty-state copy differs between the two modes ("Canvas is empty…" vs "No pinned blocks yet…"). The block renderers land in Step 12; today we show a `{visible.length} block(s)` summary so realtime subscriptions are visually verifiable.

**`ChatPane` (internal to the route for now).** Placeholder that says "Agent chat — Step 11"; replaced in Step 11.

---

### Why these specific choices

- **Components live under `components/project/` not the route file.** Three siblings (`TopBar`, `ShortlistToggle`, `SplitScreen`) are reused in principle by future project surfaces (a standardized-template project would still want the same top bar) — keeping them discoverable separates layout concerns from route data concerns.
- **The internal `CanvasPane` / `ChatPane` stay in the route for v1.** They're placeholders; promoting them to `components/project/` happens when the real implementations land in Steps 11 and 12.
- **No draggable divider state in URL or storage.** Layout preferences are low-value to persist pre-scaffolding; re-evaluate after Phase 7.
