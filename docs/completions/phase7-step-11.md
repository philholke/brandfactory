# Phase 7 Completion — Step 11

**Status:** Step 11 complete. Steps 12–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 11.
**Verification (post-Step 11):** `pnpm --filter @brandfactory/web typecheck`, `pnpm lint` — clean. Test count: 167 (unchanged; hook + SSE parser unit tests land in Step 15 alongside the rest of the frontend vitest suite).

---

## Step 11 — Chat pane (`useAgentChat`)

**Outcome:** `/projects/:projectId` now has a working chat pane. Transcript is read from `ProjectDetail.recentMessages` in the React Query cache; the textarea POSTs to `/projects/:projectId/agent` and consumes the SSE stream server-side of Phase 6. User bubbles are appended optimistically; assistant text and canvas-ops that the model issues mid-turn apply live via the same `applyAgentEvent` dispatcher the realtime subscription uses. Cmd/Ctrl+Enter sends; Enter inserts newline. Assistant content is rendered as Markdown (`react-markdown` + `remark-gfm`).

### Packages added

- `react-markdown` — GFM-flavoured markdown renderer for assistant bubbles.
- `remark-gfm` — tables, strikethrough, task lists, autolinks.

### Surface added / replaced / updated

```
packages/web/src/
├── agent/
│   ├── sseParser.ts                # new — minimal SSE frame parser (~40 lines)
│   └── useAgentChat.ts             # new — SSE client hook
├── components/project/
│   └── ChatPane.tsx                # new — transcript + input
├── realtime/
│   └── useProjectStream.ts         # updated — applyEvent → exported applyAgentEvent
└── routes/
    └── projects.$projectId.tsx     # updated — wired ChatPane in place of the placeholder
```

No new tests this step; vitest coverage for `useAgentChat` and `sseParser` lands in Step 15 per the plan.

---

### `src/agent/sseParser.ts` — `SseFrameParser`

Stateful chunk-wise parser. We own both ends (server in `packages/server/src/agent/sse.ts`, client here) and the format is a narrow subset of SSE — bringing in `eventsource-parser` is over-kill.

- `push(chunk)` appends to an internal buffer and repeatedly splits on `\n\n`, yielding every complete frame. The trailing partial frame stays buffered until the next `push`.
- `parseFrame(raw)` walks lines: `:` = comment (keep-alive pings), `event: <kind>`, `data: <json>`. Colon-space prefix stripping follows the SSE spec (`field: value` with optional leading space on value). Frames without a `data:` line are dropped — our server never emits those and the agent events are all JSON-bearing.

Behaviour with the server's concrete frames:

- `event: message\ndata: {…}\n\n` → `{ event: 'message', data: '{…}' }`.
- `event: done\ndata: {}\n\n` → terminator; hook breaks the loop.
- `event: error\ndata: {"message":"…"}\n\n` → hook sets error state + toasts.
- `: keep-alive\n\n` → swallowed (no `data:`).

---

### `src/agent/useAgentChat.ts` — `useAgentChat(projectId)`

**Shape.** `{ status, error, send, stop }` where `status: 'idle' | 'streaming' | 'error'`. Intentionally narrower than the plan's sketched `UseAgentChatResult` — `messages` and `streamingAssistant` are not returned, because both live in the React Query cache (see below).

**Why messages aren't hook state.** The server emits `message` events when an assistant text segment flushes (at tool-call boundaries or stream end) — not per-token. Each event carries the full segment. We feed them straight into `applyAgentEvent`, which appends to `ProjectDetail.recentMessages`. That's the same path realtime echoes take, so:

1. A realtime subscriber elsewhere in the app (second tab, future Cmd-K overlay) sees the same messages with no extra plumbing.
2. `applyAgentEvent` already de-dupes by `message.id`, so the late-arriving realtime echo of a message we got via SSE is a no-op.
3. We don't maintain two lists ("hook-local" vs "query-cache") that can drift.

This deviates from Vercel's `useChat` shape deliberately — our event taxonomy is richer (we stream canvas mutations alongside text), and a hook-local list would force us to merge two sources of truth into the UI.

**User-message optimism.** The server persists the user turn before streaming but does **not** echo it on the SSE stream. So `send()` writes the user message into `ProjectDetail.recentMessages` immediately (client-side `crypto.randomUUID()`). On the next `GET /projects/:id` refetch, the server's canonical row with its server-minted id replaces ours — `applyAgentEvent`'s id-based dedup means we won't double-render in the interim because realtime doesn't fan out user messages (those stay inside the POST).

**SSE consumption loop.** `fetch` → `res.body.getReader()` → `TextDecoder({stream:true})` → `SseFrameParser.push(text)`. For each frame:
- `event: done` → set status to idle, break.
- `event: error` → toast, set error + status=error, break.
- other → `JSON.parse(frame.data)` → `AgentEventSchema.parse(...)` → `applyAgentEvent(qc, projectId, parsed)`. Parse failures are silently dropped on purpose: the event taxonomy can evolve server-side without breaking older clients, and the schema is the narrow boundary.

**Error paths.**
- 401 → `useAuthStore.getState().logout()` then toast. Matches the `callJson` wrapper used elsewhere.
- 409 `AGENT_BUSY` → dedicated toast "Another turn is running on this project." Never auto-retries (per plan).
- Other non-2xx → `toast.error(body.message ?? statusText)`, status=error.
- `AbortController.abort()` via `stop()` → signal-aborted catch → status=idle, no toast.
- Network error → `toast.error(err.message)`, status=error.

**Raw `fetch`, not `hono/client`.** `hc<AppType>` wants JSON responses; our agent route returns `text/event-stream`. A typed RPC call would read and buffer the whole body. Using `fetch` directly lets us stream. Route URL is hand-constructed from `VITE_API_BASE_URL` (defaults to `/api` behind the dev proxy) — acceptable since the shape isn't changing and the hook is the only caller.

---

### `src/realtime/useProjectStream.ts` — `applyEvent` → `applyAgentEvent`

The in-file helper that walks the `AgentEvent` union and writes to the `projectKeys.detail` / `projectKeys.blocks` caches is now exported under the name `applyAgentEvent`. Both consumers (the realtime subscription here and `useAgentChat`) import the same function. Step 13 in the plan lifts it into its own module; the rename anticipates that move — keeping the same name means Step 13 is a file-level move, not a rename-and-update-callers.

Behaviour is **unchanged**. The in-turn SSE path and the realtime echo path use identical cache writes, which is the invariant the Phase-6 applier and the Step-0.2 user canvas-op routes were designed to preserve: bit-identical events → bit-identical cache state.

---

### `src/components/project/ChatPane.tsx`

**Transcript.** `messages.map((m) => <MessageBubble … />)`. When `messages.length === 0 && status === 'idle'`, shows a muted onboarding line instead of an empty div.

**`MessageBubble`.**
- User: right-aligned, `bg-primary text-primary-foreground`, `whitespace-pre-wrap` — no markdown (users type plain text; rendering their `*asterisks*` would be surprising).
- Assistant: left-aligned, `bg-muted`, `ReactMarkdown` + `remarkGfm`. Inline `prose prose-sm` Tailwind classes tighten paragraph/list spacing so multi-line markdown doesn't blow out the bubble height. `dark:prose-invert` handles the dark-mode shell from Step 2.

**Autoscroll-while-pinned.** `pinnedToBottomRef` starts `true`; `onScroll` flips it based on `scrollHeight - scrollTop - clientHeight < 32`. The autoscroll `useEffect` only runs `el.scrollTop = el.scrollHeight` while pinned. Net effect: new assistant messages scroll into view unless the user has deliberately scrolled up to re-read something.

**Input.** `<textarea>` with `rows=2`, `resize-y`, disabled while streaming. `onKeyDown` intercepts `Enter` only when `metaKey || ctrlKey` to submit — plain Enter inserts a newline. Send button: `Send` icon in idle, swapped for `Square` (stop) while streaming. Submit handler trims and swallows empty drafts, clears the textarea immediately (before awaiting the fetch) so the user can start typing the next turn without waiting.

**Thinking indicator.** `status === 'streaming'` renders a muted `Thinking…` line below the last message. Since message events are flush-on-boundary rather than per-token, a persistent indicator is more honest than a phantom "streaming cursor" that would stall between text-delta arrival and the next server flush.

**Tool-call rendering — deferred.** The plan calls for collapsed `🛠 add_canvas_block {…}` accordions. Tool-call events currently pass through `applyAgentEvent` as a no-op for cache state; they don't render. Adding the accordion UI is scoped to Step 12 (where canvas-op visual feedback matters more) or the Step-14 polish pass. Noted here so it isn't forgotten.

---

### Why these specific choices

- **Markdown deps added now, not in Step 14 polish.** Plain text would ship the hook but the first assistant reply with a bulleted list of taglines would read as literal `* tagline`. Cost is ~40 KB gz, paid once.
- **Cache as the source of truth over hook state.** Keeps the SSE path and the realtime path uniform; future features (second tab sync, command palette that quotes prior messages, search) read from one place.
- **SSE parser hand-rolled.** Owning both ends + narrow feature set + zero dependency is the right trade. If we ever accept arbitrary SSE (third-party model providers streaming directly) we revisit.
- **`fetch` not `hono/client` for the streaming route.** RPC client buffers; a streaming route needs a reader. The one URL build is acceptable complexity.
- **`applyEvent` renamed instead of re-exported under its old name.** `applyEvent` is too generic for an exported surface; `applyAgentEvent` reads correctly at call sites in both consumers. Step 13's module move inherits the good name.
