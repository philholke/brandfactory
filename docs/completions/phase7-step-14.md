# Phase 7 — Step 14 — Shell polish

Three polish items land on top of the shell — dark-mode toggle, router-
level error + pending boundaries, and `Cmd/Ctrl-S` to save in the brand
editor. The `Cmd-K` command palette is dropped per the plan's
"stretch — drop if scope pressure" guidance; nothing uses it yet and
adding a palette framework (`cmdk`) for a v1 that doesn't have enough
actions to justify it would be premature. Typecheck / lint / format /
tests clean across 9 workspaces; test count stays at 167 (Step 15
covers the frontend vitest pass).

## Files added

- `packages/web/src/lib/theme.ts` — tiny module around
  `localStorage['bf_theme']` (`'light' | 'dark' | 'system'`).
  `applyTheme(mode)` toggles `.dark` on `<html>`; `resolveTheme`
  reads `matchMedia('(prefers-color-scheme: dark)')` when mode is
  `system`. No React — callable at module-entry in `main.tsx` to
  avoid a flash of the wrong theme before the first render.
- `packages/web/src/components/ThemeToggle.tsx` — icon button in the
  top nav cycling `light → dark → system`. A `useEffect` listens to
  `prefers-color-scheme` changes only while mode is `system`, so OS-
  level flips propagate live. `title` and `aria-label` name the
  current mode + the next one; keeps the single-button UI
  screen-reader-legible. Component intentionally ignores SSR
  (`window`/`localStorage` guards live in `lib/theme.ts`).
- `packages/web/src/components/RouteError.tsx` — exports
  `RouteError` (router's `defaultErrorComponent`) and `RoutePending`
  (`defaultPendingComponent`). Error view narrows on `AppError`
  instances so the server's `{ code, message }` payload renders as-is;
  generic `Error`s show `.message`; anything else shows a fallback
  string. "Retry" calls both the router-provided `reset` and
  `router.invalidate()` so React-Query caches for the route re-fetch,
  not just the route state. "Go back" falls through to
  `window.history.back()` — cheap and doesn't need router params.

## Files modified

- `packages/web/src/main.tsx` — calls `applyTheme(getStoredTheme())`
  at module entry (before `createRoot`) so the first paint already has
  the right class on `<html>`. No flash.
- `packages/web/src/router.tsx` — wires
  `defaultErrorComponent: RouteError`,
  `defaultPendingComponent: RoutePending`, and
  `defaultPendingMs: 400`. Per-route `pendingComponent` still works
  (routes with loaders get the 400ms-guarded spinner; fast loads
  never flash one). `defaultErrorComponent` catches both loader errors
  and thrown render errors inside route subtrees; it does **not**
  catch errors in `__root.tsx` itself — those propagate to the React
  error boundary, which is acceptable for v1 (the root layout is
  trivial).
- `packages/web/src/routes/__root.tsx` — adds `<ThemeToggle />` to
  the top nav next to `<WorkspacePicker />`.
- `packages/web/src/routes/brands.$brandId.tsx` —
  `BrandEditorForm` extracts a `save()` helper out of `handleSubmit`
  and binds `Cmd/Ctrl-S` via a document-level `keydown` listener.
  Reasoning below.

## Decisions worth flagging

### `Cmd-S` via a document listener, not a form-level handler

First pass put the keydown on the `<form>` element. `jsx-a11y/
no-noninteractive-element-interactions` flags `<form>` as non-
interactive (forms receive keyboard events only because inputs inside
them do — there's no natural form-level keyboard semantic). A document
listener is the right layer: Cmd-S is a page-wide shortcut while the
brand editor is mounted. A `ref` + `useEffect` pattern keeps the
listener bound once across renders and reads the latest `save`
closure via the ref — standard React 19 guidance (a plain
`saveRef.current = save` during render trips `react-hooks/refs`, so
the assignment lives in an `useEffect` with no deps so it runs after
every render).

### Drop `Cmd-K` command palette

Plan: "Cmd-K command palette (stretch goal — drop if scope pressure)."
The actions that would go in a palette today — "new workspace", "new
brand", "open settings", "toggle theme" — are all one click away in
the existing UI. A palette without enough actions to justify it adds
a dep + another focus trap to reason about. Defer until the action
count justifies it.

### `defaultPendingMs: 400` over per-route tuning

TanStack Router's `defaultPendingMs` suppresses the pending component
for routes that resolve in <400ms. Our routes don't have loaders today
(hooks-in-component pattern) so the pending boundary rarely fires —
the default covers the future case where a route migrates to
`loader: async` without another config touch. 400ms is the Nielsen-
classic "does this feel instant" threshold; no reason to differ.

### Error boundary shows `AppError.message` directly

The server's `onError` middleware returns `{ code, message }`. Showing
`message` is often useful for users ("Workspace not found") and
always useful for devs. We don't redact — the server is the trust
boundary and it already crafts user-safe messages (Phase-5/6
verified this per the error middleware tests). If a future error
shape leaks internals, the fix is the server side.

## Items deferred from Step 14

- **`Cmd-K` command palette** — see above.
- **Route loaders for prefetch** — still on the post-Phase-7 hardening
  list (first flagged in 0.7.2's Step-5 deferred notes). Pending
  component is pre-wired for when loaders land.
- **Theme-switch transition** — instant `.dark` toggle today. A
  `view-transition-name` pass would be nice polish; defer to design.
- **Multi-tab theme sync** — `localStorage` writes don't fire in the
  same tab, and other tabs don't listen for `storage` events. Minor;
  defer.
- **Error-component screenshot / design pass** — text-only with a
  spinner/icon-less layout today. Good enough for v1.

## Verification

```
pnpm typecheck                          ✔  9/9 workspaces clean
pnpm lint                               ✔  clean
pnpm format:check                       ✔  clean
pnpm test                               ✔  167 tests (unchanged)
pnpm --filter @brandfactory/web build   ✔  dist/ clean
```

No test count change — Step 15 covers `lib/theme.ts` and the route
boundaries alongside the rest of the frontend suite. Bundle size is
unchanged to 3 decimal places (theme toggle + route error are
~1 KB gz each, lost in noise against the 354 KB baseline).
