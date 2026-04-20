# Phase 7 — Step 13 — Unified `applyAgentEvent` dispatcher

Lifts `applyAgentEvent` out of `useProjectStream.ts` into its own module
at `src/realtime/applyAgentEvent.ts`. No behaviour change — the function
body, signature, and cache writes are bit-identical to the version that
shipped in Step 11. The move is what Step 13 of the plan asked for: the
three mutation paths (local `useCanvasMutations` via realtime echo,
`useAgentChat` in-turn SSE, `useRealtime` out-of-turn fan-out) all land
in one file, so a future change to the cache-apply rules only needs to
edit one place.

## Files added

- `packages/web/src/realtime/applyAgentEvent.ts` — the dispatcher.
  Identical switch on `event.kind` — `canvas-op` (add-block /
  update-block / remove-block), `pin-op` (flip `isPinned`, add/remove
  from `shortlistBlockIds`), `message` (append to `recentMessages`,
  dedupe by id), `tool-call` (no-op). The `qc` parameter is typed as
  `QueryClient` directly (imported from `@tanstack/react-query`) rather
  than the previous `ReturnType<typeof useQueryClient>` — the direct
  type is shorter and doesn't pull a React hook into a pure function's
  surface.

## Files modified

- `packages/web/src/realtime/useProjectStream.ts` — drops the inlined
  function body, now only hosts the `useProjectStream` hook. Imports
  `applyAgentEvent` from the new module.
- `packages/web/src/agent/useAgentChat.ts` — import path updated from
  `@/realtime/useProjectStream` to `@/realtime/applyAgentEvent`.

## Decisions worth flagging

### Both entry points continue to validate at their own boundary

The plan's Step 13 notes "every incoming event is zod-validated against
`AgentEventSchema` (once at the boundary — the SSE hook and the
realtime hook each call this function)." That invariant is already in
place and stays in place:

- **`useAgentChat`** parses each SSE `data:` payload with
  `AgentEventSchema.parse` before calling `applyAgentEvent` (unparseable
  frames are dropped so the taxonomy can evolve server-side without
  breaking the client).
- **`RealtimeClient`** validates every inbound WS frame against
  `RealtimeServerMessageSchema.safeParse` (Step 6 decision), and
  `RealtimeServerMessageSchema` wraps `AgentEventSchema` — so by the
  time `useProjectStream` calls `applyAgentEvent`, the payload is
  already typed and validated.

Pushing the parse into `applyAgentEvent` itself would double-parse the
realtime path. Kept at the boundaries.

### Dedup policy unchanged

The plan mentions "duplicate events (same turn's op seen via SSE then
again via realtime) are de-duped by `block.id + updatedAt`" as a target.
Today the dispatcher dedupes on:

- `add-block` — skip if `block.id` already in the cache.
- `message` — skip if `event.id` already in `recentMessages`.
- `update-block` / `remove-block` / `pin-op` — idempotent writes
  (spread same patch, filter same id, flip `isPinned` to the same
  value) so a duplicate is a no-op in practice.

The `updatedAt`-aware check is flagged in the post-Phase-7 hardening
list (0.7.3 "Items deferred") and stays there. Switching now would
require wiring an `updatedAt` timestamp through the `canvas-op` event
shape, which is a Phase-5/6 wire change that's out of scope here.

## Items deferred from Step 13

- **Monotonic op-id dedup** — see above; still on the post-Phase-7
  list.
- **Dispatcher unit tests** — Step 15 writes `applyAgentEvent.test.ts`
  as a table-driven test over every `AgentEvent` kind with before/after
  cache snapshots. Holding off until Step 15 so the whole frontend
  vitest suite lands together.

## Verification

```
pnpm typecheck                          ✔  9/9 workspaces clean
pnpm lint                               ✔  clean
pnpm format:check                       ✔  clean
pnpm test                               ✔  167 tests (unchanged since 0.7.3)
```

No production code behaviour changed, so no smoke-test updates. Test
count stays at 167 — Step 15's vitest pass is where this dispatcher
picks up its own coverage.
