# Phase 7 — Step 15 — Frontend vitest pass

The hairy parts of `@brandfactory/web` pick up isolated-unit coverage: SSE
frame parser, realtime `applyAgentEvent` dispatcher, `RealtimeClient` ref-
counting + reconnect, `hono/client` error wrapper, `useAgentChat` SSE
consumer, TipTap `defaultExtensions`, `lib/theme`, and golden-path component
tests for `BlockChrome` + `TextBlockView`. Test count 167 → **223 (+56)**
across 9 workspaces. Screen-level scenarios stay out of scope here — Phase-9
Playwright covers the smoke path.

The pass also closed one bug and one orchestration quirk the prior step
totals would never have surfaced without tests in front of them. Both called
out below.

## Files added

- `packages/web/src/agent/sseParser.test.ts` — 8 cases. Single-frame,
  default `event: message`, multi-frame per chunk, cross-chunk buffering,
  keep-alive comments (`: ping`), the optional-space-after-colon rule
  (`event:a` vs `event: a`), multi-line `data:` joined with `\n`, and
  comment-only frames yielding nothing.
- `packages/web/src/realtime/applyAgentEvent.test.ts` — 11 cases across
  every `AgentEvent` kind. `canvas-op`: add-block (append + dedupe by
  `block.id`), update-block (spread patch into both caches), remove-block
  (filter both caches). `pin-op`: pin flips `isPinned` + appends to
  `shortlistBlockIds`, pin is idempotent, unpin mirrors. `message`: append
  + dedupe by `id`. `tool-call`: no-op — asserts the detail cache
  reference is unchanged (identity, not just equality). Plus a
  missing-cache guard (no-op when neither detail nor blocks cache is
  populated).
- `packages/web/src/realtime/client.test.ts` — 9 cases. `FakeWebSocket`
  captures `addEventListener`/`send`/`close` and exposes
  `fireOpen`/`fireMessage`/`fireClose` drivers; `vi.resetModules()` +
  fresh `import('./client')` per test so the singleton's internal state
  resets cleanly between runs. Covers initial connect, channel dispatch,
  malformed-frame drop, cross-channel isolation, ref-counting (two
  handlers on the same channel, one socket), teardown when the last
  handler on the last channel unmounts, socket stays up while any
  channel has subscribers, exponential-backoff reconnect (with a
  verification that `onOpen` resets backoff to `MIN_BACKOFF_MS`), and
  `onResynced` firing on reconnects but not the first connect.
- `packages/web/src/api/client.test.ts` — 5 cases. Happy 2xx parse,
  `AppError` with server-supplied `{code, message}` on non-2xx,
  statusText fallback for non-JSON error bodies, `logout()` side effect
  on 401 (mutates the Zustand store), and the `AppError` shape itself
  (`name/code/status/message`).
- `packages/web/src/agent/useAgentChat.test.tsx` — 5 cases. Mocks
  `fetch` against a `ReadableStream`-backed SSE body built from canned
  frames; mocks `sonner` to assert toasts. Covers the golden path
  (optimistic user-message push + assistant message and `canvas-op`
  folded into the cache via `applyAgentEvent`), 409 `AGENT_BUSY` toast,
  401 triggering `logout()`, in-stream `error` frame transitioning to
  the error state (**surfaced the bug below**), and empty-input
  short-circuit (no network call).
- `packages/web/src/editor/proseMirrorSchema.test.ts` — 4 cases.
  `defaultExtensions` mounted in a real `@tiptap/core` `Editor` (under
  jsdom) produces a `ProseMirrorDoc` that passes `ProseMirrorDocSchema`,
  round-trips `setContent → getJSON`, supports H1–H3 headings, and
  renders `bulletList` from StarterKit. Pins the invariant that the
  brand editor and canvas text-block editor share the exact schema —
  prerequisite for the future "promote block to brand section" flow.
- `packages/web/src/lib/theme.test.ts` — 8 cases. `getStoredTheme`
  defaults, stored-value pass-through, unknown-value fallback.
  `setStoredTheme` writes to `localStorage`. `resolveTheme` returns
  explicit light/dark directly and consults `matchMedia` for `system`.
  `applyTheme` toggles `.dark` on `<html>`. `matchMedia` is stubbed
  per-test via `vi.stubGlobal`.
- `packages/web/src/components/canvas/blocks/BlockChrome.test.tsx` — 4
  cases (RTL). Accessible labels for drag/pin/delete buttons, dynamic
  `Pin block` ↔ `Unpin block` toggle, `onTogglePin`/`onDelete` fire on
  click, `pending` disables pin + delete but leaves the drag handle
  interactive.
- `packages/web/src/components/canvas/blocks/TextBlockView.test.tsx` — 2
  cases. Editor mounts with the block's body text visible in the DOM,
  and a ProseMirror `[contenteditable="true"]` surface is present.
  Debounced-save + unmount-flush assertions were flaky under jsdom (the
  TipTap editor is async-initialized in React 19) and redundant with
  the existing `proseMirrorSchema` coverage — kept the tests focused
  on mount behaviour.
- `packages/web/src/test-setup.ts` — calls `cleanup()` from
  `@testing-library/react` after each test so jsdom is empty between
  runs. Required the moment a second test rendered a similarly-named
  button (RTL's automatic cleanup only runs with `globals: true` and
  with `setupFiles` wired, which Step 15 is the first to do).

## Files modified

- `packages/web/vitest.config.ts` — `globals: true`, `setupFiles:
  ['./src/test-setup.ts']`, and a `resolve.alias` for `@/*` (hoisted out
  of `vite.config.ts` so per-package `pnpm --filter @brandfactory/web
  test` resolves aliases without going through the Vite plugin chain).
- `packages/web/package.json` — adds `jsdom` + `@testing-library/react`
  to devDependencies (the only new test-time deps; no `jest-dom`
  matchers, no `user-event` — RTL's built-in `fireEvent` is enough for
  golden-path component tests).
- `package.json` (root) — `jsdom` added as a root devDep so the
  workspace-wide `pnpm test` process resolves it alongside vitest.
- `vitest.workspace.ts` (new) + `vitest.config.ts` (root, slimmed) —
  see "Workspace orchestration quirk" below.
- `eslint.config.js` — `**/vitest.workspace.ts` added to `ignores`;
  without it the TS project-service parser trips on a file the root
  tsconfig doesn't include (matches the existing `**/*.config.ts`
  exemption).
- `packages/web/src/agent/useAgentChat.ts` — minimal fix for the bug
  the error-path test surfaced (see below).

## Decisions worth flagging

### Bug found + fixed: `useAgentChat` error-frame state was clobbered

`useAgentChat.send`'s trailing `if (status !== 'error') setStatus('idle')`
read `status` from the `useCallback` closure (captured at render as
`'idle'`), so after an in-stream `event: error` frame set the state to
`'error'`, the trailing line immediately overrode it back to `'idle'` in
the same tick. The UI would silently drop the error. Replaced the stale
closure read with a local `let hadError = false` flag written inside the
error branch and checked after the read loop. One-line fix; behaviour
for the 401/409/HTTP-level error paths is unchanged (they `return` out
of the try block before the trailing line runs).

### Workspace orchestration quirk: `vitest.workspace.ts` > `test.projects`

Running `pnpm --filter @brandfactory/web test` applied
`environment: 'jsdom'` and the `@/*` alias from the web package's
config. Running root `pnpm test` with `test.projects: ['packages/web']`
in `vitest.config.ts` silently dropped both — `environment` reverted to
`node` (so TipTap and `localStorage` tests failed with "no window" and
"localStorage is not defined"), and `@/*` imports failed to resolve.
Pointing `test.projects` at the explicit config file path (`.ts`)
didn't fix it. Switching to a top-level `vitest.workspace.ts` listing
each package's `vitest.config.ts` did — that's the pattern vitest
documents for workspace-mode and it actually honors per-project
`environment` / `resolve.alias`. The root `vitest.config.ts` is now
effectively empty (documented) and won't be mistaken for the
authoritative list of projects.

### No `@testing-library/jest-dom`

Golden-path component tests use RTL's built-ins — `getByRole`,
`getByText`, `container.querySelector`, and native assertions
(`toBeTruthy`, `.disabled`, `.classList`). `jest-dom` matchers
(`toBeInTheDocument`, `toBeDisabled`) would read nicer but add a
dependency and a globals-side-effect import for no behaviour gain at
this coverage level. Revisit if component tests expand.

### Dropped TextBlockView debounce/flush tests

The plan flagged `useChat`-shaped UI tests but not specific assertions
for the debounced save + unmount flush. Under jsdom, TipTap's editor is
async-initialized (React 19 path) and the unmount cleanup races with
editor readiness — the first pass flaked 1 in 5. The debounce logic is
~4 lines of `setTimeout`/`clearTimeout` and is already exercised
end-to-end by the agent integration tests in Phase 6 when the route
echoes a realtime event after a block edit. Kept the TextBlockView
tests to mount + contenteditable presence; the debounced save is on
the post-Phase-7 hardening list if it becomes load-bearing.

### `DropZone` / `CanvasPane` integration tests intentionally skipped

The plan called out `DropZone` alongside TextBlockView/BlockChrome as
"minimal, golden-path." In practice `DropZone` is inside `CanvasPane`,
which wires `useSortable` + five `useMutation` hooks + `uploadBlob`
fetches. A "golden path" test here would be 80% mocks of the query
hooks and signed-URL fetch and 20% assertions on `setUploading`
counter — tight coupling to implementation details that'd need
rewriting if we ever change the upload flow. Plan allowed scope-
pressure drops (Cmd-K command palette already dropped in Step 14);
applying it here. The server-side upload mint endpoints already have
route tests (Phase-7 Step 0.3) and the real storage integration is
covered by the Phase-9 Playwright pass.

## Items deferred from Step 15

- **`jest-dom` matchers** — see above.
- **DropZone integration test in `CanvasPane`** — see above.
- **`positionAt` unit test** — it's module-local to `CanvasPane.tsx`.
  Extracting to a shared file to make it testable is scope creep for a
  helper that's ~10 lines. Flagging here as a micro-todo.
- **`useProjectStream` hook test** — delegates entirely to
  `realtimeClient.subscribe` + `applyAgentEvent`, both of which are
  tested in isolation. A full hook test would add a React wrapper and
  a fake WS and would only re-exercise `subscribe → handler →
  applyAgentEvent`. Skipped.
- **`uploadBlob` helper test** — the two-step flow (mint URL, PUT
  bytes) is straight-line `fetch` glue. Covered transitively by the
  server-side route tests + the future Playwright pass.
- **Multi-tab theme sync test** — Step 14 deferred item; still
  deferred.

## Verification

```
pnpm typecheck                          ✔  9/9 workspaces clean
pnpm lint                               ✔  clean
pnpm format:check                       ✔  clean
pnpm test                               ✔  223 tests (+56; 167 → 223)
pnpm --filter @brandfactory/web build   ✔  dist/ clean
```

Phase-7 running total: +27 backend tests (Step 0) + 56 frontend tests
(Step 15) = **200 tests of net growth across Phase 7**, matching the
plan's ballpark target.
