# Phase 7 — Step 12 — Canvas pane (blocks + TipTap + pinning + drop zone)

The right pane stops being a `{N} block(s)` placeholder and becomes the
real canvas: text/image/file blocks render, pin/unpin/delete work,
drag-to-reorder rewrites positions, dropping a file onto the pane
uploads it via signed URL and creates a block. All mutations go through
the same DB write → event log → realtime publish path the agent applier
already uses, so canvas state stays bit-identical between SSE
in-turn writes, realtime out-of-turn writes, and the user's own
mutations. Test count unchanged at 167 (Step 15 covers frontend
vitest); typecheck/lint/format/build clean across 9 workspaces.

## Files added

- `packages/web/src/api/queries/canvas.ts` — five mutation hooks
  (`useCreateCanvasBlock`, `useUpdateCanvasBlock`, `usePinCanvasBlock`,
  `useUnpinCanvasBlock`, `useDeleteCanvasBlock`). All non-optimistic
  for v1 — the server publishes the matching realtime event after
  every DB write and `applyAgentEvent` (via `useProjectStream`) writes
  it into the React Query cache. The mutation's returned block is
  therefore advisory; callers don't need `onSuccess` cache writes.
- `packages/web/src/api/queries/blobs.ts` — `useSignedReadUrl(key)`
  query + `uploadBlob({ file })` two-step helper. Read URLs use
  `staleTime`/`refetchInterval` of 4 min against the server's 5-min
  TTL so an `<img>` mounted at the edge of the window doesn't race
  expiry. Both endpoints use raw `fetch` (not `hono/client`) — the
  server's read-url path is `/blob-urls/:key{.+}/read-url` and the
  hono client doesn't round-trip multi-segment regex params cleanly
  (the slashes in `key` need to land in the URL path, not be
  percent-encoded into a single segment). Same reasoning `useAgentChat`
  used for the streaming endpoint in Step 11.
- `packages/web/src/components/canvas/blocks/BlockChrome.tsx` — left
  rail revealed on `group-hover`: drag handle (`GripVertical`),
  pin/unpin star, delete trash. The drag handle is the **only**
  `useSortable` listener attachment — `PointerSensor`'s 8px activation
  constraint isn't enough to disambiguate a click on the TipTap editor
  inside a text block. Same pattern the brand editor uses.
- `packages/web/src/components/canvas/blocks/TextBlockView.tsx` —
  TipTap editor seeded with `block.body`, `defaultExtensions` from
  `@/editor/proseMirrorSchema` (bit-identical to the brand editor —
  prerequisite for the future "promote canvas block to brand section"
  flow). Outbound edits debounced 500ms; cleanup flushes pending
  edits on unmount so a quick navigate-away doesn't drop the last
  keystrokes. Inbound updates are **not** synced back into the
  editor — for v1 the canvas is last-write-wins per block (Phase-7
  plan non-goals); a realtime echo of someone else's edit is dropped
  until the user re-opens the project.
- `packages/web/src/components/canvas/blocks/ImageBlockView.tsx` —
  `<img>` from `useSignedReadUrl(blobKey)`, click opens a minimal
  full-screen lightbox (button element so jsx-a11y is happy with the
  click handler). Inline alt-text input PATCHes on blur via
  `useUpdateCanvasBlock` (sends `alt: null` for an empty string —
  matches `UpdateCanvasBlockInputSchema`'s `.nullable()`).
- `packages/web/src/components/canvas/blocks/FileBlockView.tsx` —
  icon + filename + mime + "Download" link to the signed read URL.
  Plain presentation, no preview.
- `packages/web/src/components/canvas/CanvasPane.tsx` — the full pane.
  Wraps the visible blocks in `DndContext` + `SortableContext` (vertical
  strategy), renders one `SortableBlock` per visible block dispatching
  to the right view by `block.kind`, hosts the drop zone, hosts the
  "+ Text block" button. Replaces the inline `CanvasPane` previously
  defined in `routes/projects.$projectId.tsx`.

## Files modified

- `packages/web/src/routes/projects.$projectId.tsx` — drops the inline
  placeholder `CanvasPane`, imports the real one from
  `@/components/canvas/CanvasPane`. Passes `projectId={data.id}`
  alongside `blocks` and `shortlistBlockIds`.

## Decisions worth flagging

### No optimistic mutations

Plan: "Every mutation round-trips today" (post-Phase-7 hardening item).
Realtime echo from the server lands in <100ms on a healthy connection;
the perceptible latency is the pin star not flipping immediately.
Adding optimistic apply means writing rollback-on-error for every
mutation kind and de-duping the realtime echo with a key richer than
`block.id` (since the local optimistic apply already added the block).
Defer until it bites.

### Drag-reorder writes one block, not the whole list

Plan: "PATCH the moved block with its new position." `positionAt`
sandwiches the moved block between its new neighbors as
`Math.floor((before + after) / 2)`; bookends by ±1000 when no
neighbor exists. This stays inside `int4` (the `canvas_blocks.position`
column type) for a long time before two adjacent positions converge
to consecutive integers and need a server-side rebalance pass — a
follow-up if/when it happens. Cheaper than rewriting N positions per
drag and matches the same sparse-integer trick the brand editor uses.

### Drop zone — no per-file progress bar

A `uploading` count maintains a per-upload skeleton block. We don't
plumb byte-level progress because the upload is a single PUT to
storage that already gives us "done or failed" semantics, and the
storage adapter (local-disk or supabase) handles its own streaming.
Skeletons disappear when the create-block mutation resolves (which is
also when the realtime echo paints the real block in place).

### `dragOver` highlight is intentionally noisy

`onDragEnter` toggles a primary-tinted dashed outline as soon as the
browser reports a `Files` drag is over the pane. `onDragLeave` only
clears when leaving the pane element itself (`e.currentTarget ===
e.target`) so child elements don't flicker the highlight as the
cursor moves. Mostly correct in practice; not tested under
keyboard-driven drag.

### MIME allowlist is checked client-side AND server-side

The `ALLOWED_UPLOAD_MIMES` tuple lives in
`packages/shared/src/blob/upload.ts`; the client refuses unsupported
types with a toast before minting an upload URL, and the server
rejects with `400 INVALID_CONTENT_TYPE` if the client lies. Two
checks for one rule, but the client check saves a round-trip and the
server check is the trust boundary.

### TipTap content is mounted once

Plan note from Step 9 carried over: re-running `useEditor` with new
`content` on every realtime echo would trash mid-edit cursor state.
The editor is keyed by `block.id` (via React's identity in
`SortableBlock`) so a different block remounts the editor, but the
same block's body never re-syncs from props. v1 trade — see "no
optimistic" reasoning above.

## Items deferred from Step 12

- **Optimistic canvas mutations.** Same as the changelog entry for
  Step 0 — every write round-trips today. Pin toggle latency is the
  most visible offender.
- **Width/height on image upload.** `CreateImageCanvasBlockInputSchema`
  accepts `width`/`height`; we leave them undefined and let `<img>`
  use natural sizing. A pre-upload `Image()` probe could fill them
  for layout stability; not worth the complexity for v1.
- **Server-side position rebalance.** `positionAt` will eventually
  produce two equal positions after enough back-and-forth dragging in
  the same gap. A periodic rebalance to sparse integers
  (1000, 2000, 3000…) on the server side fixes it; deferred until the
  symptom appears.
- **Tool-call accordion UI in chat.** Was flagged in Step 11 deferred
  list; still pending — `tool-call` events still pass through
  `applyAgentEvent` as a no-op.
- **Frontend vitest coverage** for `CanvasPane`, block renderers,
  upload helper, and `positionAt`. Step 15 scope.
- **Inbound edit sync** for TipTap text blocks (collaborative editing).
  Out of scope for v1 per the plan's "no CRDT" non-goal.
- **Lightbox polish.** Current implementation is one fullscreen image
  + click-to-close. No prev/next, no keyboard navigation, no zoom.

## Verification

```
pnpm typecheck                          ✔  9/9 workspaces clean
pnpm lint                               ✔  clean
pnpm format:check                       ✔  clean
pnpm test                               ✔  167 tests (unchanged since 0.7.3)
pnpm --filter @brandfactory/web build   ✔  dist/ clean
```

The pre-existing 1.1 MB JS chunk warning is unchanged — TipTap +
Radix dominate. Bundle budget is on the post-Phase-7 hardening list.
