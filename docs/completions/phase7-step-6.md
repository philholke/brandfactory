# Phase 7 Completion — Step 6

**Status:** Step 6 complete. Steps 7–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 6.
**Verification (post-Step 6):** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count: 167 (unchanged; realtime hooks have no isolated logic units to unit-test without a fake WS — covered by Step 15's `client.test.ts`). `pnpm --filter @brandfactory/web build` produces `dist/` clean.

---

## Step 6 — Realtime client + hooks

**Outcome:** a singleton `RealtimeClient` that multiplexes many channel subscriptions over one WebSocket, a `useRealtime` hook that integrates with it, and a `useProjectStream` hook that applies incoming `AgentEvent`s to the React Query cache.

### Surface added

```
packages/web/src/
└── realtime/
    ├── client.ts             # new — RealtimeClient class + realtimeClient singleton
    ├── useRealtime.ts        # new — useRealtime(channel, handler) hook
    └── useProjectStream.ts   # new — useProjectStream(projectId) hook + applyEvent helper
```

---

### `src/realtime/client.ts` — RealtimeClient

Single shared WebSocket with ref-counted channel subscriptions. The socket opens on the first `subscribe` call and closes when the last subscriber unmounts.

#### State machine

```
idle → connecting → open ←→ reconnecting
```

- **idle** — no active channels; no socket.
- **connecting** — socket is being established; `onOpen` will subscribe all pending channels.
- **open** — socket is live; new subscriptions are sent immediately.
- **reconnecting** — socket closed unexpectedly; a timer will re-enter `connecting`.

#### Subscribe / unsubscribe

`subscribe(channel, handler)` returns an unsubscribe function. Internally:
1. The channel → `Set<Handler>` map is updated.
2. If `idle`: call `connect()`. If `open`: send `{ type: 'subscribe', channel }` immediately. If `connecting` / `reconnecting`: `onOpen` will send all channel subscriptions on open.
3. The returned cleanup function removes the handler from the Set. When the Set empties: send `{ type: 'unsubscribe', channel }` (if open), delete the channel from the map. When the map empties: call `closeSocket()`.

**Why ref-counting per handler, not per channel?** Multiple React components on the same project subscribe to the same channel. Ref-counting prevents the last unsubscriber from tearing down subscriptions that other mounted components still need.

#### Reconnect with exponential backoff

`onClose` (fired by the browser when the socket drops) schedules `connect()` after `backoffMs` (starts at 1 s, doubles each failed attempt, caps at 30 s). `backoffMs` resets to 1 s on every successful `onOpen`. No reconnect is scheduled if `closeSocket()` was called intentionally (state flips to `idle` first; `onClose` checks).

#### On reconnect: resync notification

After a reconnect, `onOpen` fires all registered `ResyncHandler`s (registered via `onResynced(handler)`). Consumers use this to invalidate React Query caches — state may have drifted during the outage. The notification is skipped on the initial connection (`connectionCount === 1`) to avoid a spurious invalidation at mount.

#### Payload validation

`onMessage` parses the raw frame with `JSON.parse` and then validates it through `RealtimeServerMessageSchema.safeParse`. Invalid frames are silently dropped — this guards against a compromised realtime bus poisoning React state with malformed events.

#### WS URL construction

```ts
function toWsUrl(url: string): string {
  if (url.startsWith('/')) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}${url}`
  }
  return url.replace(/^http/, 'ws') // http→ws, https→wss
}
```

`VITE_RT_URL` (default `/rt`) can be a relative path (proxied by Vite dev server) or an absolute HTTP/HTTPS URL. Either way, `toWsUrl` produces the correct `ws://` or `wss://` address.

Token is appended as `?token=<jwt>` to the URL — the only place where this is forced (browser `WebSocket` constructor doesn't accept `Authorization` headers). Matches the server's `?token` fallback in `ws.ts`.

#### Design note: no `error` listener

`WebSocket.onerror` always fires immediately before `close`. The `onClose` handler is the canonical place to initiate reconnects. Adding an `error` handler would duplicate the reconnect path with no additional information (the error event carries no useful data beyond the fact that an error occurred).

---

### `src/realtime/useRealtime.ts`

```ts
export function useRealtime(channel: string, handler: (payload: AgentEvent) => void): void {
  useEffect(() => {
    return realtimeClient.subscribe(channel, handler)
  }, [channel, handler])
}
```

`useEffect` returns the unsubscribe cleanup. Deps are `[channel, handler]` — the subscription is recreated only when the channel or handler changes.

**Why not the "latest ref" pattern?** React 19's `react-hooks/refs` ESLint rule (`eslint-plugin-react-hooks` recommended) prohibits `ref.current = value` during render. The alternative is `useInsertionEffect`-based ref updates, but that adds complexity for no practical benefit here: `useProjectStream` already wraps its handler in `useCallback([qc, projectId])`, making it stable across renders. Callers are expected to memoize handlers; the hook documents this requirement.

---

### `src/realtime/useProjectStream.ts`

Subscribes to `project:<projectId>` and applies incoming `AgentEvent`s to the React Query cache.

#### `applyEvent(qc, projectId, event)` — internal helper

Module-level function (not exported). Handles each `AgentEvent` kind:

| Event kind | Action |
|-----------|--------|
| `canvas-op / add-block` | Append block to `projectKeys.detail` + `projectKeys.blocks` caches; deduplicate by `block.id` |
| `canvas-op / update-block` | Spread `op.patch` (cast `unknown → Partial<CanvasBlock>`) onto matching block in both caches |
| `canvas-op / remove-block` | Filter out `op.blockId` from both caches |
| `pin-op / pin` | Set `isPinned: true` on matching block; add `blockId` to `shortlistBlockIds` in `projectKeys.detail` |
| `pin-op / unpin` | Mirror |
| `message` | Append message to `recentMessages` in `projectKeys.detail`; deduplicate by `message.id` |
| `tool-call` | No-op — no cache state; renders in chat pane only |

Both `projectKeys.detail(id)` and `projectKeys.blocks(id)` caches are updated for block mutations. This keeps the standalone caches (used if `useProjectBlocks` is called independently) in sync with the embedded `blocks` array in `ProjectDetail`.

**`op.patch` cast** — `UpdateBlockOpSchema.patch` is `JsonValue` (the shared schema can't narrow to `Partial<CanvasBlock>` without coupling to canvas block structure). The server emits the correct partial shape after Zod validation; the double-cast `as unknown as Partial<CanvasBlock>` is a deliberate trust boundary.

#### Resync on reconnect

```ts
useEffect(() => {
  return realtimeClient.onResynced(() => {
    void qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
  })
}, [qc, projectId])
```

On WS reconnect, the project detail is invalidated so React Query refetches the authoritative server state. This covers any mutations that arrived while the client was disconnected. The `void` operator satisfies `no-floating-promises` — invalidation is fire-and-forget.

---

### Step 13 relationship

`applyEvent` is defined inline here (not exported) because Step 13 extracts it into `src/realtime/applyAgentEvent.ts` with deduplication logic for SSE-vs-realtime echoes. The signature is identical to what Step 11's `useAgentChat` will call. Step 13 replaces the local definition with the shared import and adds the dedup key.

---

### Items deferred from Step 6

- **Token rotation on Supabase refresh.** Supabase access tokens expire and `@supabase/supabase-js` auto-refreshes them. The realtime client reads the token once at connect time; if the token rotates mid-session, the WS uses the old token until the next reconnect. For v1 single-seat self-hosted, the session lifetime is short enough that this is acceptable. Fix: listen to `useAuthStore` token changes and call `closeSocket()` + reconnect.
- **Unit tests for `RealtimeClient`.** Plan §Step 15 schedules `src/realtime/client.test.ts` with a fake WS mock. Covered there.
- **`useRealtime` unit test.** Same: Step 15.
- **Multiple subscriptions to the same channel from the same component.** Calling `useRealtime` twice with the same channel in one component works (two handler entries in the Set), but is unusual. No guard needed.
