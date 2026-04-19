# Changelog

Latest releases at the top. Each version has a one-line entry in the index
below, with full detail further down.

## Index

- **0.6.1** — 2026-04-19 — Pre-Phase-6 hardening: realtime WS heartbeat, `verifySignature` clock-skew tolerance, `ProseMirrorDocSchema` parse on DB reads, `@brandfactory/db` vitest suite, `userId` in server error logs. 120 tests (+14).
- **0.6.0** — 2026-04-19 — Phase 5: `@brandfactory/agent` ships `streamResponse` over an injected `CanvasOpApplier`, plus a four-item hardening pass (realtime subscribe race, `BLOB_MAX_BYTES` 413, two LOW cleanups). 106 tests.
- **0.5.1** — 2026-04-19 — Post-Phase-4 cleanup: project+canvas tx helper, `LLMProviderId` single-sourced in shared, trust-boundary validation on `workspace_settings`, discriminated `RealtimeAdapter` (no `as` cast in `main.ts`), `BlobNotFoundError` `instanceof`, atomic `updateBrandGuidelines` helper.
- **0.5.0** — 2026-04-19 — Phase 4: `@brandfactory/server` ships a bootable Hono-on-`@hono/node-server` HTTP surface with WS upgrade at `/rt`, conditional `/blobs` mount, request-id → logger → auth → validator → handler → onError middleware chain, six route modules, `workspace_settings` table, and 49 new vitest cases (83 total).
- **0.4.1** — 2026-04-19 — Pre-Phase-4 cleanup: tighter env exhaustiveness, server-grade ESLint (type-aware with `no-floating-promises`), timing-safe `verifySignature`, RFC-4122 v4 UUID regex, `createCanvas` helper, three new env tests, architecture doc drift fixed.
- **0.4.0** — 2026-04-19 — Phase 3: four `@brandfactory/adapter-*` packages land with ports + default impls, `@brandfactory/server` gains `loadEnv()` + `buildAdapters()`, vitest stands up across the repo with 31 unit tests green.
- **0.3.0** — 2026-04-18 — Phase 2: `@brandfactory/db` lands — drizzle schema for 8 tables, singleton pg `Pool`, 18 query helpers, local-dev docker Postgres, and an end-to-end smoke check.
- **0.2.0** — 2026-04-18 — Phase 1: `@brandfactory/shared` lands as the single source of truth for domain types and zod schemas, consumed by both `server` and `web`.
- **0.1.0** — 2026-04-18 — Project bootstrap: vision, architecture blueprint, scaffolding plan, and Phase 0 repo foundation.

---

## 0.6.1 — 2026-04-19

Hardening pass surfaced by a repo-wide review after Phase 5 landed,
sized to close the gaps Phase 6's `POST /projects/:id/agent` route
would otherwise trip over. Five items: one HIGH (long-lived WS
connection leak), three MEDIUM (storage clock skew, JSON trust
boundary on DB reads, `@brandfactory/db` had zero vitest coverage),
one LOW polish (server error log missed `userId`). No new feature
surface. `pnpm test` grew from 106 (0.6.0) to 120 (+14: +12 mapper
unit tests in `@brandfactory/db`, +1 realtime zombie-socket test,
+1 storage clock-skew test); typecheck, lint, format clean across 9
workspaces.

### HIGH — realtime WS heartbeat (zombie socket sweep)

`@brandfactory/adapter-realtime`'s native-ws bus had no heartbeat,
ping/pong, or connection timeout. A client that vanishes without
sending a close frame (tab suspended, laptop lid closed, network
drop, mobile app killed) leaves the socket half-open on the server:
`socket.send(...)` succeeds into a dead TCP buffer, the `close`
handler never runs, and the subscription map holds the handler
forever. Over a production deployment's uptime that's a memory leak
and a silent event-delivery hole — and Phase 6 is exactly the
workload that fans events to long-lived subscribers, so we fix it
before the route lands.

- **`packages/adapters/realtime/src/native-ws.ts`** — `BindOptions`
  grows an optional `heartbeatIntervalMs` (default 30 000, matching
  common ws deployments). In `bindToNodeWebSocketServer`:
  - On each `'connection'`: tag the socket `isAlive = true`, attach a
    `'pong'` listener that re-tags it `true`.
  - A `setInterval(sweep, intervalMs)` iterates `wss.clients`: any
    socket with `isAlive === false` (i.e. didn't pong since the
    previous tick) gets `socket.terminate()`; the rest are flipped
    to `false` and sent a `socket.ping()`. Terminate forces the
    'close' handler to run, which releases the socket's
    subscriptions via the existing unsubscribe map.
  - `heartbeat.unref()` so the interval doesn't block process
    shutdown, and `wss.on('close', () => clearInterval(heartbeat))`
    cleans up in test harnesses that spin up many ephemeral buses.
- **`packages/adapters/realtime/src/native-ws.test.ts`** — new
  `terminates zombie sockets…` case drives the sweep with
  `heartbeatIntervalMs: 40` and overrides the client's `pong`
  method to a no-op so `ws`'s auto-pong never actually writes
  bytes. The server sees no reply, terminates on the second tick,
  and the client observes the close event within the safety
  timeout. Harness extended to plumb the option through `startBus`.
- **Interval sizing.** 30 s is standard; halving it doubles the
  ping volume without meaningfully improving eviction latency.
  Kept configurable so Phase 6's production deployment (or ops
  folks tuning for mobile clients) can override without a code
  change.

### MEDIUM — storage clock-skew tolerance on `verifySignature`

`verifySignature` compared `exp >= now` with zero tolerance. A
client a handful of seconds ahead of the server would get a
spurious 403 on an otherwise-valid URL — operationally fragile in
multi-host deploys without tight NTP. Not a security property
loss: the signature itself is still HMAC-verified in constant
time; the skew only widens the expiry check.

- **`packages/adapters/storage/src/local-disk.ts`** — exports new
  `CLOCK_SKEW_TOLERANCE_SECONDS = 10` and `VerifySignatureInput`
  grows an optional `clockSkewSeconds`. The expiry check becomes
  `input.exp + skew >= now` (still `Number.isFinite`-guarded so a
  nonsense exp can't exploit the tolerance). Timing-safe compare
  path unchanged: HMAC is computed and compared before the expiry
  decision, so the two failure modes remain indistinguishable via
  response timing.
- **`packages/adapters/storage/src/local-disk.test.ts`** — new
  `verify tolerates a client clock a few seconds ahead of exp`
  case asserts both sides: a `now` 5 s past exp passes (within
  tolerance), a `now` 15 s past exp throws (beyond it). The
  existing `verify rejects an expired signature` case updated to
  use `now - 30` so it's unambiguously outside the 10 s window.
- **`packages/server/src/routes/blobs.test.ts`** — mirroring
  update to the server's `expired signature → 403` case for the
  same reason.
- **Why 10 s.** Enough to absorb NTP drift and the typical
  network latency between signer and verifier; short enough that
  an attacker replaying a just-expired URL doesn't get a
  meaningful extension. Exposed as an input so deployments with
  unusually loose clock sync (or unusually strict requirements)
  can override per call.

### MEDIUM — `ProseMirrorDocSchema` parse on DB reads

`@brandfactory/db/src/mappers.ts` blind-cast `row.body as
ProseMirrorDoc` in both `rowToGuidelineSection` and
`rowToCanvasBlock`'s text arm. Writes are gated by zod at the
route layer today, but Phase 6 adds a new writer — the agent's
`add_canvas_block` tool — and a corrupted row (bad migration,
direct-DB edit, historical data) would otherwise propagate
silently into prompt assembly, canvas-op fan-out, or the wire
DTO. Moving the parse into the mapper closes the trust boundary
on reads too.

- **`packages/db/src/mappers.ts`** — imports shift to a value
  import of `ProseMirrorDocSchema` (keeping the type imports
  colocated via `type` in the mixed import list). New module-local
  `parseProseMirrorBody(body, rowId)` runs `safeParse` and throws
  `Row <id> has malformed ProseMirror body` on failure — a
  data-integrity bug worth failing loud on, consistent with the
  existing missing-field throws for image/file rows.
  `rowToGuidelineSection` and the text case of `rowToCanvasBlock`
  both call it.
- Consistent error shape: the existing `throw new Error(...)`
  messages on missing `blobKey` / `filename` / `mime` / `templateId`
  are the model, and the new check reads the same way. The server's
  `onError` middleware already catches these as unhandled → 500,
  which is the right surface for "the DB gave us something
  malformed." If Phase 6 ever wants a typed domain-error variant,
  the single call site is the hook.

### MEDIUM — `@brandfactory/db` vitest suite

Before this pass the package shipped `scripts/smoke.ts` (live-DB,
manual) and zero `vitest` coverage. That was fine at Phase 2 when
the schema was new and the query helpers were trivial, less fine
now that mappers enforce invariants and Phase 6's applier will
write through multiple transactional helpers. The mapper layer is
pure (JSON in, domain object out) — ideal for fast unit tests that
run on every `pnpm test` without needing Postgres.

- **`packages/db/package.json`** — adds `vitest ^2.1.8` devDep
  and a `test: vitest run` script, matching every other package.
- **`packages/db/vitest.config.ts`** — projects-mode entry,
  mirrors the adapters and agent packages so
  `pnpm --filter @brandfactory/db test` behaves identically to the
  root `pnpm test`.
- **Root `vitest.config.ts`** — `packages/db` appended to the
  `projects` list.
- **`packages/db/src/mappers.test.ts`** — 12 new cases, no
  database, all deterministic:
  - Happy paths for `rowToWorkspace`, `rowToBrand`, `rowToCanvas`,
    `rowToGuidelineSection`, `rowToProject` (both `freeform` and
    `standardized` variants), and `rowToCanvasBlock` (text and
    image with optional dims).
  - Data-integrity failures fail loud:
    `rowToGuidelineSection` and `rowToCanvasBlock(text)` throw on
    a malformed body (input is a `Map` to simulate a non-JSON
    serialized artifact); `rowToProject` throws on standardized +
    null `templateId`; `rowToCanvasBlock` throws on image without
    `blobKey` and file without `filename`.
- **Live-DB integration tests deferred** for this pass — the
  existing `scripts/smoke.ts` already walks the full lifecycle
  against real Postgres (users → workspace → brand → sections →
  project+canvas → blocks → events → shortlist → soft-delete →
  settings), and promoting it to a gated vitest suite is a
  mechanical refactor that can ride with Phase 6 where a live
  Postgres harness will already be in scope for the applier route
  tests.

### LOW — `userId` in the server's unhandled-error log context

`packages/server/src/middleware/error.ts:29` already logged
`{ name, message, stack }` on an unhandled error, and the logger is
bound with `requestId` on middleware entry — but `c.var.userId`
was not propagated. That made tracing production incidents harder:
`requestId` correlates across a single request, `userId`
correlates across a session.

- **`packages/server/src/middleware/error.ts`** — reads
  `c.get('userId')` and spreads `{ userId }` into the log fields
  when defined (skipped cleanly on unauthenticated paths). One
  line-net change; no test required since the existing
  `error.test.ts` covers the unhandled path and the log is a
  diagnostic side effect.

### Deliberately deferred

Surfaced by the same review, kept out of scope for this pass by
design:

- **`projects.template_id` CHECK constraint.** The mappers
  already throw on a standardized row with null `templateId`
  (defense-in-depth landed in Phase 5). A DB-level `CHECK (kind
  = 'freeform' OR template_id IS NOT NULL)` adds a second rail,
  but lands cleanest via a `drizzle-kit generate` round-trip
  against a live DB — not worth hand-authoring the migration +
  snapshot drift. Ride with the next planned migration.
- **Model-id whitelist in `@brandfactory/adapter-llm`.** Only
  load-bearing once runtime overrides from the settings route
  reach arbitrary strings; today the settings route validates
  against the shared `LLMProviderIdSchema` and the model id comes
  from the same trust boundary as the provider.
- **Brand name / description prompt-injection sanitation in
  `buildSystemPrompt`.** Real risk is low (a user only authors
  their own brand), and any hardening belongs at the create-time
  validation boundary rather than the prompt-assembly layer.

### Verification

```
pnpm install        ✔  lockfile updated (vitest added to @brandfactory/db)
pnpm typecheck      ✔  9/9 workspaces pass
pnpm lint           ✔  clean
pnpm format:check   ✔  clean
pnpm test           ✔  120 tests passing (25 files) — up from 106
```

---

## 0.6.0 — 2026-04-19

Phase 5 lands `@brandfactory/agent` — a server-only orchestration
library that turns `(brand, canvas, user message) → streamed
AgentEvent[]`. Same release rolls in a four-item hardening pass
surfaced by a repo-wide review of phases 0–5: one HIGH (realtime
subscribe race), one MEDIUM (unbounded blob PUT body), two LOW
(redundant DB predicate, overlapping shared union). `pnpm test` grew
from 83 (0.5.1) to 106 (+20 from the agent package, +3 from the
hardenings); typecheck, lint, format clean across 9 workspaces.

### Phase 5 — `@brandfactory/agent`

A pure-orchestration library. **It never talks to the DB, the realtime
bus, or an HTTP surface directly** — all side effects flow through an
injected `CanvasOpApplier`. Phase 6's `POST /projects/:id/agent` route
implements that interface against the real persistence layer and
forwards the resulting events to SSE + the realtime bus.

#### Package wiring

- **`packages/agent/package.json`** — new package. Deps:
  `@brandfactory/shared`, `@brandfactory/adapter-llm` (both
  `workspace:*`), `ai ^4.0.20` (kept in lockstep with adapter-llm so
  the shared `LanguageModel` type references exactly one copy of
  `ai`), `zod ^4.3.6`. Dev-deps: `@types/node`, `tsx`, `vitest`.
  Scripts: `typecheck`, `lint`, `test` (`vitest run`), `smoke` (`tsx
  scripts/smoke.ts`).
- **`packages/agent/vitest.config.ts`** — projects-mode entry,
  mirrors the other packages so `pnpm --filter @brandfactory/agent
  test` and the root `pnpm test` behave identically.
- **`packages/agent/tsconfig.json`** — `include` widened to
  `['src/**/*.ts', 'scripts/**/*.ts']` and `rootDir: src` dropped, so
  `scripts/smoke.ts` participates in the TS project (otherwise
  type-aware ESLint fails with "was not found by the project
  service").
- **Root `vitest.config.ts`** — appended `packages/agent` to the
  `projects` list.

#### Prompt assembly — system + canvas context

- **`packages/agent/src/prompts/prose-mirror-to-text.ts`** —
  `proseMirrorDocToPlainText(doc)`. Walks a ProseMirror / TipTap JSON
  tree and flattens it. Block-level node types (paragraph, heading,
  list_item, blockquote, code_block, bullet_list, ordered_list,
  horizontal_rule — both snake_case and camelCase spellings)
  produce their own block, joined with `\n\n`; inline text nodes
  concatenate. Deliberately lossy: marks (bold/italic/links) are
  dropped because the model doesn't need them and stripping them
  keeps the prompt compact.
- **`packages/agent/src/prompts/system-prompt.ts`** —
  `buildSystemPrompt(brand: BrandWithSections): string`. Fixed
  composition order: role preamble → `# Brand: <name>` (+
  description if set) → `## Brand guidelines` (sections rendered in
  ascending `priority` order; block skipped when zero sections) →
  `## Canvas awareness` paragraph naming the three tools so the
  model can reason about intent. Tests pin structural invariants but
  not exact wording, so future wordsmithing doesn't break the suite.
- **`packages/agent/src/prompts/canvas-context.ts`** —
  `buildCanvasContext({ blocks, shortlistBlockIds, recentOps? }):
  string`. Renders `CANVAS STATE` block with `PINNED:` /
  `UNPINNED:` lists; unpinned items truncated at
  `CANVAS_CONTEXT_UNPINNED_LIMIT = 20` (exported for Phase 6
  tuning) with an `… and K more` tail. `RECENT OPS:` block rendered
  only when non-empty. `summarizeBlock` branches text /
  image / file: text is plain-text-flattened, whitespace-collapsed,
  truncated at 200 chars; image is `[image: <alt|"untitled">]
  (W×H)?`; file is `[file: <name>] (<mime>)`. Pure / deterministic /
  memoizable.

#### Canvas tools + `CanvasOpApplier` (the side-effect seam)

- **`packages/agent/src/tools/applier.ts`** — `CanvasOpApplier`
  interface: `addCanvasBlock(input)`, `pinBlock(blockId)`,
  `unpinBlock(blockId)`. v1 `AddCanvasBlockInput` is `{ kind:
  'text', body: ProseMirrorDoc, position: number }` — image/file
  variants intentionally deferred (both need a `blobKey` from the
  separate upload flow, not minted by the agent). Every method
  returns the applied `CanvasBlock` so the stream layer can
  synthesize the `canvas-op`/`pin-op` event without a second DB
  round-trip.
- **`packages/agent/src/tools/definitions.ts`** —
  `buildCanvasTools(applier, opts?)`. Three AI-SDK tools
  (`add_canvas_block`, `pin_block`, `unpin_block`) whose parameter
  schemas reuse `ProseMirrorDocSchema` / `CanvasBlockIdSchema` from
  shared (no redefinition). Each `execute` returns a compact `{
  blockId, isPinned }` so the model reasons about what happened
  without leaking full rows into the conversation. Tool names
  exported via `CANVAS_TOOL_NAMES`. **Internal `onApplied` hook**:
  `opts.onApplied?(toolCallId, event)` fires after the applier
  returns, passing the AI-SDK's `toolCallId` and a pre-shaped
  `CanvasOpEvent`/`PinOpEvent` — this is the hook `streamResponse`
  uses to correlate tool-results to canvas-op events. External
  callers that just want the `ToolSet` (e.g. a Phase-6 authz
  introspector) pass no opts.

#### `streamResponse` — the entry point

- **`packages/agent/src/stream.ts`** — `streamResponse(input):
  AsyncIterable<AgentEvent>`. Builds system-prompt + canvas-context
  and concatenates as `system + '\n\n' + canvasContext` (the
  context is prepended to system, not injected as a user message,
  so the model treats it as static context); builds tools with the
  `onApplied` hook that stores events in a
  `Map<toolCallId, event>`; translates `AgentMessage[]` → AI-SDK
  `CoreMessage[]`; calls `streamText({ model, system, messages,
  tools, abortSignal })`; consumes `result.fullStream` as an async
  generator yielding typed `AgentEvent`s. Buffer flush points:
  `text-delta` accumulates and lazily allocates an assistant
  message id (`randomUUID()`); `tool-call` flushes pending text
  then yields a `tool-call` event; `tool-result` looks up the
  pending event by `toolCallId` and yields it; `step-finish` /
  `finish` flush text; `error` re-throws out of the generator.
  Trailing `takeMessage()` after the loop covers the case where
  the upstream stream ended without a finish part.
  - **Widened local stream-part type.** AI-SDK exports
    `TextStreamPart<TOOLS>`; with `TOOLS` inferred as the generic
    `ToolSet`, the `tool-call` / `tool-result` arms narrow to
    `never`. A local `AgentStreamPart` union redeclares the minimal
    shape we consume plus an explicit "other kinds" arm
    (`reasoning` / `source` / `file` / `step-start` /
    `tool-call-streaming-*`) so the `switch` stays exhaustive
    without a default-case never-guard. Runtime behaviour is
    unchanged — purely a TS-side workaround for v4 inference. The
    only `as` cast in the package (`as unknown as
    AsyncIterable<AgentStreamPart>`) is documented in-place.
  - **Message-id allocation.** Phase 5 mints assistant message ids
    locally (uuid v4). Phase 6 is free to regenerate them DB-side
    on persist — the id is opaque before that point, no conflict.

#### Barrel + smoke

- **`packages/agent/src/index.ts`** — re-exports only the public
  surface: `streamResponse`, `StreamResponseInput`,
  `buildSystemPrompt`, `buildCanvasContext`,
  `BuildCanvasContextInput`, `CANVAS_CONTEXT_UNPINNED_LIMIT`,
  `buildCanvasTools`, `CANVAS_TOOL_NAMES`, `CanvasOpApplier`,
  `AddCanvasBlockInput`. Internal helpers and the widened
  stream-part type stay private. No `**/*` globs in `exports`.
- **`packages/agent/scripts/smoke.ts`** — drives `streamResponse`
  against a real openrouter-backed `LLMProvider` with an in-memory
  `InMemoryApplier` that records every mutation. Hard-coded
  "Northstar Coffee" `BrandWithSections` (voice + audience), two
  seed canvas blocks (one pinned, one draft), single user message
  asking for three taglines via `add_canvas_block` then a pin.
  Prints each event as it arrives. Exits 0 on success, 1 if the
  script fatals, 2 if the run completed but the applier never
  received an `add_canvas_block` call (signal: model doesn't
  tool-use reliably, not a bug in the package). Gated on
  `OPENROUTER_API_KEY` — missing key is a clear error + exit 1, not
  a mid-stream failure.

#### Tests (Phase 5)

20 new vitest cases, all deterministic / no network:

- `prompts/prose-mirror-to-text.test.ts` — 6 cases: paragraph;
  paragraph + heading; bullet list; nested list; inline text runs;
  empty doc.
- `prompts/system-prompt.test.ts` — 2 cases: happy path (brand
  name, description, section labels in priority order, plain-text
  bodies, no raw JSON); brand with zero sections (canvas-awareness
  block still rendered, guidelines block skipped).
- `prompts/canvas-context.test.ts` — 4 cases: empty canvas (both
  placeholders); pinned/unpinned split across text/image/file;
  unpinned truncation + "and K more" tail; RECENT OPS rendering.
- `tools/tools.test.ts` — 5 cases: exposed tool names; each tool's
  `execute` forwards args to the applier and returns compact JSON;
  zod rejects bad input before any applier call.
- `stream.test.ts` — 3 cases driven by a hand-rolled
  `LanguageModelV1` fake: plain text-delta stream → single
  assistant `message` event; text-delta → tool-call → synthesized
  `canvas-op` (asserts both event order AND that the applier was
  called with decoded args); upstream `error` part → generator
  throws with the original message.

The fake `LanguageModel` implements only the slice `streamText`
actually touches (`specificationVersion`, `provider`, `modelId`,
`defaultObjectGenerationMode`, `supportsImageUrls`,
`supportsStructuredOutputs`, `doGenerate` (throws), `doStream`).
Cast through `as unknown as LanguageModel` — the AI-SDK doesn't
export a test helper.

#### Phase 5 non-goals (reaffirmed)

Deliberately out of scope; Phase 6 or later: route in
`@brandfactory/server`, persistence, realtime publish, workspace-
settings resolution (caller passes `{ providerId, modelId }` in
`llmSettings`), assistant-message persistence, rate-limit /
concurrency-guard.

---

### Post-Phase-5 hardening pass

Same review cadence as 0.4.1 / 0.5.1. Four items surfaced by a
repo-wide audit of phases 0–5; all four landed in this release so
Phase 6 starts on a clean floor. Three are tiny / boundary-only;
one (the realtime subscribe race) is the kind of latent bug that
Phase 6's high-rate text-delta fan-out would have surfaced as
"every token shows up twice in the canvas".

#### Realtime — same-tick subscribe race (HIGH)

`adapter-realtime/native-ws.ts` previously did the dedup check
synchronously (`if (unsubscribers.has(msg.channel)) return`) but
populated the unsubscribers map only after `opts.authorize`
resolved. Two `subscribe` messages for the same channel arriving
in the same tick both passed the dedup check, both awaited
authorize, and both registered a handler — the client then
received every event N times for N rapid duplicates. Phase 6
fans agent text-deltas through this bus at high rate and any
client that re-subscribes on reconnect / visibility-change can
trigger it.

- **`packages/adapters/realtime/src/native-ws.ts`** — stake a
  placeholder unsubscribe in the map *before* awaiting authorize.
  After authorize: if denied AND the slot still holds the
  placeholder, delete it; if the socket closed mid-await (the
  `close` handler clears the map), bail out. Otherwise replace
  the placeholder with the real unsubscribe. Single-tick dedup
  now works because the map is mutated synchronously on the first
  subscribe.
- **`packages/adapters/realtime/src/native-ws.test.ts`** — new
  case: fire two `subscribe` messages for the same channel
  back-to-back with an async `authorize` that takes 25ms; assert
  `authorize` runs exactly once and a single `publish` arrives at
  the client exactly once. Without the placeholder, both
  assertions fail.

#### Blobs — `BLOB_MAX_BYTES`-gated 413 (MEDIUM)

`PUT /blobs/:key` previously called `c.req.arrayBuffer()` with no
ceiling. The signed URL is short-lived and gated by HMAC, so the
attack surface is "an authenticated client can OOM the server",
which is small but real and trivial to exploit. Plan deferred
content-type / max-body to Phase 8, but a max-body limit is one
constant + one length check — splitting it from content-type and
landing it now is cheap.

- **`packages/server/src/env.ts`** — new env var `BLOB_MAX_BYTES`
  (`z.coerce.number().int().min(1).default(25 * 1024 * 1024)`). Not
  conditional on `STORAGE_PROVIDER` so the route can read it
  without branching; supabase deploys simply never hit the route.
- **`packages/server/src/routes/blobs.ts`** — `BlobsDeps` gains
  `maxBytes: number`. PUT handler reads `content-length` first and
  rejects with `413 BLOB_TOO_LARGE` before reading the body when
  declared length exceeds the cap. After reading: a
  belt-and-suspenders second check on `buf.byteLength` catches
  clients that omit or lie about `content-length`.
- **`packages/server/src/app.ts`** — passes
  `deps.env.BLOB_MAX_BYTES` into `createBlobsRouter`.
- **`packages/server/src/test-helpers.ts`** — `testEnv` defaults
  `BLOB_MAX_BYTES: 25 * 1024 * 1024`; `createTestApp` already
  threads `env` overrides through `createApp`, so route tests can
  shrink the cap to 4 bytes for assertion.
- **`.env.example`** — documents `BLOB_MAX_BYTES=26214400` with a
  comment about the 413 path.
- **`packages/server/src/routes/blobs.test.ts`** — two new cases:
  PUT with `content-length: 5` against `BLOB_MAX_BYTES=4` →
  413 (pre-read path); PUT with the same body but no
  `content-length` header → still 413 (post-read path). Both
  assert the storage was not written.

#### DB — drop redundant `isNotNull` predicate (LOW)

`db/queries/events.ts:listBlockEvents` previously did
`where(and(eq(canvasEvents.blockId, blockId), isNotNull(canvasEvents.blockId)))`.
The `isNotNull` is implied by the equality on a non-null parameter
— the predicate read as if `blockId` were a nullable parameter,
which it isn't. Cosmetic but distracting; SQL behaviour unchanged.

- **`packages/db/src/queries/events.ts`** — drop the
  `isNotNull(canvasEvents.blockId)` clause; drop the now-unused
  `isNotNull` import. Behaviour parity preserved (existing tests
  cover the path).

#### Shared — collapse overlapping `RealtimeEventPayload` union (LOW)

`shared/realtime/envelope.ts` declared
`RealtimeEventPayloadSchema = z.union([AgentEventSchema,
CanvasOpEventSchema, PinOpEventSchema])`. But `AgentEventSchema`
already unions all four `AgentEvent` branches (message, tool-call,
canvas-op, pin-op), so the trailing two branches are redundant.
No security impact (the union accepts the same set of values
either way), but the structure was confusing — and would eventually
mislead a reader who assumed the trailing branches existed for a
reason.

- **`packages/shared/src/realtime/envelope.ts`** —
  `RealtimeEventPayloadSchema = AgentEventSchema` (re-aliased so
  call sites read as wire-protocol code, not agent-internals
  code). `RealtimeEventPayload` type unchanged. Two import
  symbols (`CanvasOpEventSchema`, `PinOpEventSchema`) dropped from
  the file's import line.

### Items still on the deferral list

Same review surfaced these; each has a natural home in a later
phase, none block Phase 6:

- WS `?token=` query fallback exposure to upstream proxy logs —
  Phase 7 CORS + cookie-based ticket flow.
- Logger redaction for tokens / secrets — Phase 8 swap to pino.
- Blobs PUT content-type persistence — Phase 8 polish (content-
  type already accepted on the request, just not stored alongside
  bytes).
- 404 vs 403 ordering on `GET /brands/:id` and friends —
  consistent across routes, matches the WS `authorizeChannel`
  walk; product call to revisit.
- Live WS upgrade end-to-end test, live HTTP/WS boot smoke
  transcript — needs Postgres + Docker; held over from Phase 4.
- `update_block` / `remove_block` agent tools — re-open after we
  see what the model tries to do.
- Image / file canvas tool variants — needs the agent-side story
  for obtaining a `blobKey`.

### Verification

```
pnpm install        ✔  lockfile updated, no new peer-dep categories
pnpm typecheck      ✔  9/9 workspaces pass
pnpm lint           ✔  0 problems
pnpm format:check   ✔  all files clean
pnpm test           ✔  24 files, 106 tests pass (was 24 / 103)
pnpm --filter @brandfactory/agent smoke
                    ☐  run locally with OPENROUTER_API_KEY set
```

---

## 0.5.1 — 2026-04-19

Cleanup pass surfaced by a repo-wide review after Phase 4 landed. Six
correctness / type-system / boundary tightenings, no new feature
surface. `pnpm test` holds at 83 tests (the existing route coverage
already exercised every changed path; behaviour parity preserved);
typecheck, lint, format clean across 9 workspaces.

### Project + canvas — atomic creation in one transaction

- **`packages/db/src/queries/projects.ts`** — new
  `createProjectWithCanvas(input): Promise<{ project; canvas }>` runs
  both inserts inside `db.transaction`. Mirrors the existing
  `CreateProjectInput` discriminator. Phase 4 ran the two inserts
  back-to-back; a mid-write failure orphaned the project and surfaced
  as a 500 with no canvas. Phase 5's agent will create projects
  programmatically — fix-before-it-bites.
- **`packages/server/src/db.ts`** — `Db` facade now exposes
  `createProjectWithCanvas` and drops the standalone `createProject`
  / `createCanvas` (the route was the only consumer; the lower-level
  helpers stay on the `@brandfactory/db` surface for the smoke
  script).
- **`packages/server/src/routes/projects.ts`** — POST
  `/brands/:brandId/projects` calls the new helper and destructures
  `{ project }` so the response body is unchanged.
- **`packages/server/src/test-helpers.ts`** — fake
  `createProjectWithCanvas` writes both maps in one shot; signatures
  match the real helper.
- **`packages/server/src/{authz,ws}.test.ts`** — seed helpers updated
  to use `createProjectWithCanvas` (drift here would have failed
  compile after the facade change).

### `LLMProviderId` — single source of truth in shared

The four-provider tuple was redeclared in three places (shared's
`workspace/settings.ts` schema, adapter-llm's `port.ts` union,
server's `env.ts` const tuple). The server's `as const satisfies
readonly LLMProviderId[]` caught server↔adapter drift, but a
divergent shared schema would have shipped silently and Phase 5's
agent reads `resolveLLMSettings` — a drifted shared schema could
emit a wrong `llmProviderId` value through the wire DTO.

- **New: `packages/shared/src/llm/provider-ids.ts`** — owns
  `LLM_PROVIDER_IDS` (the const tuple), `LLMProviderIdSchema =
  z.enum(LLM_PROVIDER_IDS)`, and `type LLMProviderId =
  z.infer<...>`. Single source.
- **`packages/shared/src/index.ts`** — barrel exports the new
  module.
- **`packages/shared/src/workspace/settings.ts`** — drops its local
  `z.enum([...])` declaration; imports `LLMProviderIdSchema` from
  `../llm/provider-ids`. The `WorkspaceSettings`,
  `UpdateWorkspaceSettingsInput`, and
  `ResolvedWorkspaceSettings` schemas keep their existing names
  and shapes.
- **`packages/adapters/llm/src/port.ts`** — drops its local
  string-literal union; re-exports `LLMProviderId` from
  `@brandfactory/shared` so existing call sites
  (`import { LLMProviderId } from '@brandfactory/adapter-llm'`)
  keep working.
- **`packages/adapters/llm/package.json`** — adds
  `@brandfactory/shared: workspace:*` to deps. No cycle (shared
  has no adapter deps).
- **`packages/server/src/env.ts`** — imports `LLM_PROVIDER_IDS`
  directly from shared. The local tuple + `satisfies` block goes
  away; the `superRefine` `default: never` exhaustiveness guard
  stays.
- **`packages/server/src/settings.ts`** — `env.LLM_PROVIDER` is now
  natively typed `LLMProviderId`, so the `as LLMProviderId` cast in
  `resolveLLMSettings` is removed along with the "kept aligned by
  hand" comment.

After this pass there is exactly one place to widen the provider
list; every consumer fails compile or boot if anyone tries to
drift.

### `workspace_settings` — trust-boundary validation, not a CHECK

The column is intentionally `text` (not `pgEnum`) so widening the
provider list doesn't need a migration — but that meant any
caller using an `as`-cast or hand-rolled SQL could write garbage
that bypassed the route's zod gate. Adding a CHECK constraint
would have undone the widen-without-migration design.

- **`packages/db/src/queries/workspace-settings.ts`** —
  `rowToWorkspaceSettings` (read path) and
  `upsertWorkspaceSettings` (write path) both run the value
  through `LLMProviderIdSchema.parse`. The helper is now the
  trust boundary: nothing past it sees a provider id outside
  `LLM_PROVIDER_IDS`. If the shipped enum widens in shared but
  production hasn't deployed the new server yet, a row written by
  the new code surfaces loudly in the old code instead of
  corrupting downstream typing.
- **`packages/db/src/schema/workspace_settings.ts`** — comment
  updated to call out the helper as the trust boundary, with a
  pointer to the `LLMProviderIdSchema` parse.
- Migration intentionally not regenerated; column type is
  unchanged.

### Realtime — discriminated-union return from `buildAdapters`

`main.ts` previously did `adapters.realtime as
NativeWsRealtimeBus` to reach `bindToNodeWebSocketServer`. The
cast defeated the type system — adding a future redis or supabase
realtime impl would have failed at runtime, not compile time.

- **`packages/server/src/adapters.ts`** — new `RealtimeAdapter =
  { provider: 'native-ws'; bus: NativeWsRealtimeBus }`
  discriminated union. `Adapters.realtime: RealtimeAdapter`.
  `buildAdapters` returns `{ provider: 'native-ws', bus:
  createNativeWsRealtimeBus() }`.
- **`packages/server/src/main.ts`** — cast removed. The Hono app
  receives `adapters.realtime.bus` directly (it only needs the
  `RealtimeBus` pub/sub surface). The WS upgrade is mounted via a
  `switch` on `adapters.realtime.provider` with a `const
  _exhaustive: never = adapters.realtime.provider` default branch
  — adding a second variant fails compile at the `default:` case.
- **`packages/server/src/adapters.test.ts`** — assertion updated
  to check `realtime.provider === 'native-ws'` and that
  `realtime.bus` carries the expected functions.
- `AppDeps.realtime` keeps its `RealtimeBus` type (the app
  doesn't need the binder), so route modules and `createTestApp`
  are unchanged.

### Blobs — `instanceof BlobNotFoundError`

- **`packages/server/src/routes/blobs.ts`** — imports
  `BlobNotFoundError` from `@brandfactory/adapter-storage`; uses
  `err instanceof BlobNotFoundError` instead of the previous
  `(err as Error).name === 'BlobNotFoundError'` sniff. The class
  is already on the storage port, so the sniff bought nothing
  and was brittle if the impl ever renamed it.
- **`packages/server/src/routes/blobs.test.ts`** — fake store
  throws `new BlobNotFoundError(key)` instead of constructing a
  generic `Error` with a hand-set `name`.

### Brand guidelines — atomic upsert + reorder

Phase 4's `PATCH /brands/:id/guidelines` looped `upsertSection`
(one statement per item, no shared tx) then called
`reorderSections` (which is itself in a tx). A failure mid-loop
left the brand half-updated.

- **`packages/db/src/queries/brands.ts`** — new
  `updateBrandGuidelines(brandId, sections):
  Promise<BrandGuidelineSection[]>`. Single `db.transaction`:
  each input either updates an existing row by id+brand or
  inserts a new one; the final select returns the sorted list,
  same shape as `listSectionsByBrand`. `upsertSection` and
  `reorderSections` are kept on the package surface — the smoke
  script still uses `upsertSection`.
- **`packages/server/src/db.ts`** — `Db` facade exposes
  `updateBrandGuidelines` instead of `upsertSection` +
  `reorderSections`. The route was the only server consumer.
- **`packages/server/src/routes/brands.ts`** — PATCH calls
  `updateBrandGuidelines` with a flat map; the previous "collect
  ids, then reorder" two-step is gone.
- **`packages/server/src/test-helpers.ts`** — fake
  `updateBrandGuidelines` mirrors the real helper's "update by
  id, else insert" branch and returns the sorted section list.

### Items deliberately deferred

Same review surfaced these; each has a natural home in a later
phase, none block Phase 5:

- WS `?token=` query fallback exposure to upstream proxy logs —
  Phase 7 CORS / cookie-based ticket flow.
- Logger redaction for tokens/secrets — Phase 8 swap to pino.
- Blobs PUT content-type / max-body validation — Phase 8 polish
  (content-type persistence is already on that list).
- Live WS upgrade end-to-end test — needs the live boot smoke
  (Postgres + ws server); captured under Phase 4 follow-ups.
- 404 vs 403 ordering on `GET /brands/:id` and friends —
  consistent across routes, matches the WS `authorizeChannel`
  walk; product call to revisit.

### Verification

All green:

```
pnpm install       ✔
pnpm typecheck     ✔  9/9 workspaces pass
pnpm lint          ✔  0 problems
pnpm format:check  ✔  all files clean
pnpm test          ✔  19 files, 83 tests pass
```

Phase 4 wrap was already at 83; this pass kept the count steady
because every changed code path had route-level coverage.

### Post-Phase-4 cleanup record — `docs/completions/phase4-cleanup.md`

Per-issue writeup of all six fixes, files changed, the
deliberately-deferred items, and the rationale for choosing
helper-boundary validation over a `CHECK` constraint on
`workspace_settings.llm_provider_id`.

---

## 0.5.0 — 2026-04-19

The first bootable backend in the repo. `@brandfactory/server`
ships a Hono-on-`@hono/node-server` HTTP surface with a `/rt`
WebSocket upgrade, wired to the Phase 3 adapter bundle and the
Phase 2 query helpers. Running `pnpm --filter @brandfactory/server
dev` boots the server end-to-end: `loadEnv()` → `buildAdapters` →
`buildDbDeps` → `createApp` → `serve` → `mountRealtime` →
SIGTERM/SIGINT-driven ordered shutdown (WS → HTTP → `pool.end()`).
Test count grew from 34 to 83 (49 new server tests across 11 new
files); typecheck, lint, format clean across 9 workspaces.

### Phase 4 execution plan — `docs/executing/phase-4-server.md`

Expanded Phase 4 of the scaffolding plan into a file-by-file task
list and locked sixteen design decisions: Hono on
`@hono/node-server`, the `main.ts` (deploy entry) /
`app.ts` (factory) / `index.ts` (barrel) split, end-to-end types
via Hono's chained `.get/.post` builders so Phase 7 can infer
through `hono/client`, zod at every boundary via
`@hono/zod-validator`, bearer-only auth with `c.var.userId` as the
contract, single-owner authorization via `requireXAccess` walks,
~40-line inline JSON logger, minimal error boundary with a wire
shape Phase 9 will keep stable, env-only API keys with a
`workspace_settings` row for provider/model overrides,
`PATCH /brands/:id/guidelines` as an upsert-and-reorder over the
full section list (deletion out of scope), `/blobs` mounted only
when `STORAGE_PROVIDER === 'local-disk'`, `/rt` upgrade via
`ws.Server({ noServer: true })` with token via `Authorization` or
`?token=`, channel naming `project:` / `brand:` / `workspace:`
with an `authorizeChannel` walk, `dev` script as `tsx watch
src/main.ts` (build deferred to Phase 8), and vitest coverage of
every middleware + route happy path + at least one error path.

### Shared additions — client-importable DTOs

Phase 4 introduced four new HTTP boundaries; their input/output
schemas live in shared so `web` can validate the same wire types.

- `workspace/settings.ts` — `WorkspaceSettingsSchema`,
  `UpdateWorkspaceSettingsInputSchema`,
  `ResolvedWorkspaceSettingsSchema` (`{ workspaceId,
  llmProviderId, llmModel, source: 'workspace' | 'env' }`). Plus a
  client-importable `LLMProviderIdSchema` (re-aligned to a single
  source of truth in 0.5.1).
- `workspace/create.ts` — `CreateWorkspaceInputSchema` (`{ name }`
  only; `ownerUserId` is injected by the route from the authed
  user).
- `brand/create.ts` — `CreateBrandInputSchema` (`{ name,
  description? }`).
- `brand/update-guidelines.ts` —
  `UpdateBrandGuidelinesInputSchema` (`{ sections: Array<{ id?,
  label, body, priority }> }`). `id` present → upsert existing,
  absent → insert new. Section deletion is out of scope for
  Phase 4.
- `project/create.ts` — `CreateProjectInputSchema` discriminated
  on `kind ∈ {freeform, standardized}`.
- `src/index.ts` — barrel updated.

### DB additions — `workspace_settings` table

- `src/schema/workspace_settings.ts` — singleton-per-workspace
  row: `workspace_id uuid pk fk→workspaces(id) on delete
  cascade`, `llm_provider_id text`, `llm_model text`,
  `updated_at timestamptz`. Provider id is stored as `text`, not
  a `pgEnum`, so the shipped-provider list can widen without a
  migration; the server validates `LLMProviderIdSchema` at the
  edge.
- `src/queries/workspace-settings.ts` —
  `getWorkspaceSettings`, `upsertWorkspaceSettings`
  (`INSERT ... ON CONFLICT (workspace_id) DO UPDATE`).
- `drizzle/0001_shocking_the_watchers.sql` — generated via
  `pnpm --filter @brandfactory/db db:generate`. Idempotent
  (`IF NOT EXISTS` on the table, `DO $$ BEGIN ... EXCEPTION
  WHEN duplicate_object` on the FK).
- `scripts/smoke.ts` extended: asserts `getWorkspaceSettings`
  returns `null` pre-write, then upsert-with-provider-a →
  upsert-with-provider-b exercises the `ON CONFLICT` branch.

### Server implementation — `packages/server`

The bulk of the phase. Twenty-plus source files, eleven new
test files.

- **`package.json`** — added `hono`, `@hono/node-server`,
  `@hono/zod-validator` (bumped to `^0.7.6` for zod-4 support),
  `ws`, `@brandfactory/db` runtime deps; `@types/ws` dev dep;
  `dev` / `start` scripts (`tsx watch src/main.ts` /
  `tsx src/main.ts`).
- **`src/env.ts`** — appended `PORT` (coerced number, default
  `3001`), `HOST` (default `'0.0.0.0'`), `LOG_LEVEL` (enum,
  default `'info'`). No `superRefine` changes needed.
- **`src/logger.ts`** — ~55-line inline JSON logger with level
  filtering and a `child(fields)` builder. Injectable `write`
  and `now` for tests; the default writes
  `JSON.stringify({ ts, level, msg, ... })` to stdout.
- **`src/errors.ts`** — `HttpError` plus `UnauthorizedError`,
  `ForbiddenError`, `NotFoundError`, `ValidationError`
  subclasses. Wire shape `{ code, message, details? }` matches
  what Phase 9 will keep stable.
- **`src/context.ts`** — `AppEnv` bindings type; `ServerHono`
  alias so every route module shares the same `c.var` types.
- **`src/middleware/request-id.ts`** — reads `x-request-id`,
  falls back to `randomUUID()`, echoes the header on the
  response.
- **`src/middleware/logger.ts`** — attaches a child logger (with
  `requestId`) to `c.var.log`; logs `{ method, path, status,
  durationMs, userId }` after each request.
- **`src/middleware/auth.ts`** — `createAuthMiddleware(auth)`
  extracts `Bearer <token>`, calls `auth.verifyToken`, writes
  `c.var.userId` or throws `UnauthorizedError`.
  `createOptionalAuthMiddleware(auth)` attaches `userId` when a
  valid token is present but never throws — used on `/health`.
- **`src/middleware/error.ts`** — `onError` maps `HttpError` →
  status+code, `ZodError` → 400 with `details`, unknown → 500
  and logs the stack.
- **`src/authz.ts`** — `requireWorkspaceAccess`,
  `requireBrandAccess`, `requireProjectAccess`. The `AuthzDeps`
  interface lists only the `getXById` helpers each walk uses, so
  tests drop in fakes without touching the singleton.
- **`src/db.ts`** — `Db` interface + `buildDbDeps()` facade over
  `@brandfactory/db`'s module exports. Each field is typed as
  `typeof db.helperName`, so renaming or changing a helper's
  signature in Phase 2's package surfaces here as a type error.
- **`src/settings.ts`** — `resolveLLMSettings(workspaceId, env,
  deps)`. Returns the stored row with `source: 'workspace'` or
  falls back to env with `source: 'env'`. Phase 6 consumes it
  from the agent endpoint.
- **`src/routes/health.ts`** — `GET /health` → `{ status: 'ok',
  version }`. No auth required.
- **`src/routes/me.ts`** — `GET /me`; calls
  `auth.getUserById(userId)`, 404s `USER_NOT_FOUND` on miss.
- **`src/routes/workspaces.ts`** — `GET /`, `POST /`, `GET /:id`
  (with `requireWorkspaceAccess` on the single-resource route).
- **`src/routes/brands.ts`** — two router factories
  (`createWorkspaceBrandsRouter` for `GET /:workspaceId/brands`
  and `POST /:workspaceId/brands`; `createBrandsRouter` for
  `GET /:id` and `PATCH /:id/guidelines`) mounted separately at
  `/workspaces` and `/brands` in `app.ts`. `GET /:id` hydrates
  sections into `BrandWithSections`. `PATCH /:id/guidelines`
  loops `upsertSection` then calls `reorderSections` with the
  full priority list (refactored to a single-tx
  `updateBrandGuidelines` helper in 0.5.1).
- **`src/routes/projects.ts`** — `createBrandProjectsRouter`
  (list + create under `/brands/:brandId/projects`) and
  `createProjectsRouter` (`GET /projects/:id`). Creation
  implicitly creates the 1:1 canvas row (refactored to a single
  `createProjectWithCanvas` tx helper in 0.5.1).
- **`src/routes/settings.ts`** — `GET` + `PATCH` on
  `/workspaces/:id/settings`.
- **`src/routes/blobs.ts`** — `GET /:key{.+}` + `PUT /:key{.+}`
  (wildcard segment matches nested keys). Both verify
  `?exp=&sig=` via `verifySignature` and surface `ForbiddenError`
  on mismatch. `GET` returns a `Response(bytes)` with
  `content-type: application/octet-stream` (content-type
  persistence is a Phase 8 polish). `PUT` reads the request body
  via `c.req.arrayBuffer()` and calls `storage.put(key, bytes,
  { contentType })`.
- **`src/app.ts`** — `createApp(deps)` composes middleware +
  routes and returns the typed Hono instance. Mounts `/health`
  first, then path-scoped auth middleware on `/me/*`,
  `/workspaces/*`, `/brands/*`, `/projects/*`, then the route
  modules, then `/blobs` if `STORAGE_PROVIDER === 'local-disk'`.
  Exports `type AppType = ReturnType<typeof createApp>` so
  Phase 7's `hono/client` can infer end-to-end types.
- **`src/ws.ts`** — `mountRealtime({ httpServer, realtime,
  auth, db, log })`. Creates `ws.Server({ noServer: true })`,
  intercepts `httpServer`'s `upgrade` only on pathname `/rt`,
  and binds the realtime bus with a token-based `authenticate`
  and an `authorizeChannel`-based `authorize`. Token extraction
  accepts both `Authorization: Bearer` and `?token=` (browsers
  can't set custom headers on `new WebSocket`). Returns a
  `close()` handle for graceful shutdown.
- **`src/main.ts`** — the deployable entry: `dotenv/config` →
  `loadEnv` → `createLogger` → `buildAdapters` → `buildDbDeps`
  → `createApp` → `serve` → `mountRealtime`. `SIGTERM`/`SIGINT`
  trigger an ordered shutdown (WS → HTTP → `pool.end()`).
- **`src/index.ts`** — barrel extended with `createApp`,
  `AppType`, `buildDbDeps`, `Db`, `createLogger`, `Logger`,
  `LogLevel`, the error classes, and `mountRealtime`.
- **`src/test-helpers.ts`** — `silentLogger`, `createFakeDb`
  (in-memory implementation of the full `Db` surface),
  `createFakeAuth`, `createFakeAdapters`, `testEnv`,
  `createTestApp`. Every fake matches the real signature so
  drift in the underlying package shows up as a type error.

### Tests — 11 new files, 49 new tests

Totals: 13 server files / 58 server tests, 19 repo files / 83
repo tests.

- `src/middleware/auth.test.ts` — valid bearer, missing header,
  invalid token, optionalAuth no-header, optionalAuth with valid
  token (5).
- `src/middleware/error.test.ts` — `HttpError`, `HttpError` with
  details, `ZodError` → 400, unknown → 500 with `log.error`
  called (4).
- `src/authz.test.ts` — owner passes / non-owner 403 / missing
  404 per helper (9).
- `src/routes/health.test.ts` — smoke (1).
- `src/routes/me.test.ts` — happy path, 404 when the auth
  provider has no matching user, 401 without a bearer (3).
- `src/routes/workspaces.test.ts` — create-mine, list-mine-only,
  forbidden-on-others, 400 on empty name (4).
- `src/routes/brands.test.ts` — create in owned workspace,
  forbidden on non-owned workspace, `GET /brands/:id` hydrates
  sections, `PATCH` upsert + reorder (label edit + priority
  swap) (4).
- `src/routes/projects.test.ts` — freeform create (asserts the
  canvas was implicitly created), standardized create with
  `templateId`, `GET /projects/:id` returns `canvas` nested (3).
- `src/routes/settings.test.ts` — env fallback, PATCH then GET
  reflects `source: 'workspace'`, bogus provider → 400 (3).
- `src/routes/blobs.test.ts` — signed PUT, signed GET
  (round-trip), expired → 403, tampered → 403, missing sig
  params → 400, not-mounted under `STORAGE_PROVIDER=supabase` →
  404 (6).
- `src/ws.test.ts` — `authorizeChannel` for workspace / brand /
  project happy paths, wrong user denied, missing aggregate
  denied, unknown prefix denied, malformed channel denied (7).

### `.env.example` — extended

Appended `PORT`, `HOST`, `LOG_LEVEL` with a comment explaining
that `/blobs` is only mounted when
`STORAGE_PROVIDER=local-disk`. Updated `BLOB_PUBLIC_BASE_URL`
default to `:3001/blobs` to match `PORT=3001`.

### API notes worth remembering

- **Hono sub-app middleware bleeds across `app.route('/',
  child)`.** The first attempt defined an "auth-required"
  sub-app (`api.use('*', authRequired)`) and mounted it at `/`.
  That made the auth middleware fire for `/blobs/*` too —
  breaking the blob tests with 401s. Fix: drop the sub-app and
  scope `authRequired` per prefix on the root app
  (`app.use('/me/*', authRequired)` etc.). Route modules
  themselves stayed unchanged.
- **`zod-validator` peer range.** `@hono/zod-validator@0.4.x`
  peers `zod@^3.19.1`, which breaks with zod 4. `0.7.6` peers
  `zod ^3.25 || ^4.0`. Bumped on install.
- **`@hono/node-server`'s `serve()` return type.** The callback
  receives a partial `{ port }` info object; the function
  returns Node's `http.Server` but the type assertion has to be
  `as unknown as HttpServer` because the exported type uses a
  narrower interface. Isolated to `main.ts`.
- **Hono param wildcards.** `/:key{.+}` matches keys with `/`
  segments (needed for nested blob paths). Documented in Hono
  but non-obvious; `/:key` alone would reject
  `nested/path/hello.txt`.
- **`BlobNotFoundError` detection.** Phase 4 sniffed `err.name
  === 'BlobNotFoundError'` to keep `routes/blobs.ts` decoupled
  from the storage impl package; 0.5.1 swapped this for
  `instanceof BlobNotFoundError` against the exported class.

### Phase 4 completion record — `docs/completions/phase4.md`

Phase-level wrap with per-file detail (mirrors the Phase 3
writeup shape rather than splitting per-task). Captures the
sixteen locked decisions delivered as specified, the ws-mount
override surprise, the conditional `/blobs` mount, and the
follow-ups (live boot smoke against Postgres / live WS upgrade
/ logger swap to pino in Phase 8).

### Verification

All green:

```
pnpm install       ✔
pnpm typecheck     ✔  9/9 workspaces pass
pnpm lint          ✔  0 problems
pnpm format:check  ✔  all files clean
pnpm test          ✔  19 files, 83 tests pass (was 13 files / 34 tests)
```

Zero new peer-dep warnings beyond the pre-existing
`ai-sdk`/`zod@3` set documented in 0.4.0. The live HTTP/WS boot
smoke (`curl localhost:3001/health` etc.) needs a running
Postgres; Docker wasn't available in the session so that
transcript wasn't captured — `createApp` runs end-to-end against
every route in unit tests, including the blob upload/download
round-trip, the auth gate, the error boundary, and the
conditional `/blobs` mount.

---

## 0.4.1 — 2026-04-19

Cleanup pass surfaced by a repo-wide review after Phase 3 landed. No new
surface area, no phase progression — purely raising the floor before
Phase 4 starts writing the HTTP/WS server. `pnpm test` grew from 31 to
34 tests (two env conditional-required additions, one UUID-version
test), all green; typecheck, lint, format clean across 9 workspaces.

### Server env loader — exhaustiveness + coverage

- **`packages/server/src/env.ts`** — the `LLM_PROVIDER` switch inside
  `superRefine` now has a `default` branch with
  `const _exhaustive: never = env.LLM_PROVIDER` + a `ctx.addIssue` that
  reports `unhandled LLM_PROVIDER: <value>`. Why: the existing
  `as const satisfies readonly LLMProviderId[]` guard catches
  *syntactic* drift between the schema's enum tuple and
  `adapter-llm`'s `LLMProviderId`, but if the union widens and the
  switch isn't updated, the previous code silently skipped
  per-provider validation. Now a future widening fails the TS
  assignment (compile time) *and* the env loader (runtime) — belt and
  suspenders. How to apply: this is the standard "enum + switch"
  exhaustiveness pattern; use it any time we have a narrowing switch
  over a union imported from another package.
- **`packages/server/src/env.test.ts`** — two new tests covering
  gaps the Phase 3 suite left open:
  - "rejects supabase storage missing all three required fields"
    — asserts all three messages (`SUPABASE_URL`,
    `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET`) appear in the
    single thrown error.
  - "reports every failure in a single error when multiple
    conditions are violated" — supabase auth + supabase storage +
    anthropic LLM all misconfigured in one env; asserts five
    distinct field names surface in the same error. Locks in
    `loadEnv`'s "report every issue, not just the first" contract.
  Test count for `env.test.ts` is now 8 (was 6).

### ESLint — type-aware, server-ready

- **`eslint.config.js`** — flipped parser to type-aware mode
  (`parserOptions.projectService: true`,
  `tsconfigRootDir: import.meta.dirname`) and added three rules:
  - `@typescript-eslint/no-floating-promises` — Phase 4 introduces
    async HTTP/WS handlers; a dropped promise in a route silently
    swallows its rejection and never reaches the error middleware.
    The rule forces every promise to be awaited, void-ed, or
    returned.
  - `@typescript-eslint/no-explicit-any` — prevents `any` as an
    escape hatch; use `unknown` with a narrowing check instead.
  - `@typescript-eslint/consistent-type-imports` with
    `fixStyle: 'inline-type-imports'` — keeps runtime vs type-only
    imports explicit so bundlers can drop type-only imports cleanly
    and `verbatimModuleSyntax` doesn't surprise anyone.
  Also extended `ignores` with `**/drizzle/**` and `**/*.config.ts`
  so generated migration SQL and bespoke Node config files don't
  need to sit inside a tsconfig project for the type-aware parser.
- **`packages/adapters/storage/src/local-disk.ts`** + **`supabase.ts`**
  — two import lines fixed by `eslint --fix` (type-only imports moved
  to `import type`). No runtime change.
- Intentionally *not* adopted: `@typescript-eslint/recommendedTypeChecked`
  — it pulled in `require-await`, `no-unnecessary-type-assertion`,
  `no-base-to-string`, and `prefer-promise-reject-errors`, which
  collectively flagged 36 pre-existing issues across mappers, test
  fakes, and idiomatic drizzle casts. Adopting those rules is a
  bigger cleanup (and some of the flagged casts are load-bearing for
  drizzle's inferred row types). We picked the three rules that pay
  for themselves immediately and deferred the rest.

### Storage — constant-time `verifySignature`

- **`packages/adapters/storage/src/local-disk.ts`** — `verifySignature`
  now always computes the HMAC and runs `timingSafeEqual` before
  deciding expired-vs-tampered. Previously the expiry check returned
  first, so a remote observer could theoretically distinguish
  "signature expired" from "signature tampered" by response-time
  delta. Not exploitable given a 15-minute TTL and the current lack
  of a Phase 4 HTTP route to measure against, but it's
  defense-in-depth for when that route lands. Implementation: the
  provided sig is padded/truncated to `expected.length` so
  `timingSafeEqual` never throws on length, then both "sig matches"
  and "not expired" are evaluated and the function throws a single
  `InvalidSignatureError('invalid signature')` if either fails. All
  six existing tests still pass — they assert on the error class,
  not the message.

### Auth — RFC-4122 v4 regex

- **`packages/adapters/auth/src/local.ts`** — the UUID regex now
  requires the version nibble to be `4` and the variant nibble to be
  one of `{8, 9, a, b}`. Previously it accepted any 128-bit hex in
  UUID shape. Practical impact is near-zero (pg's
  `gen_random_uuid()` only ever emits v4, so real dev tokens already
  match), but the provider is now refusing tokens that couldn't have
  come from our ID generator — a cheap invariant to enforce.
- **`packages/adapters/auth/src/local.test.ts`** — `VALID_UUID`
  updated to a valid v4 shape (`…-4333-8444-…`); added a new test
  "verifyToken rejects a non-v4 uuid token" that uses the old
  non-v4 shape as the negative. Test count is now 5 (was 4).

### DB — `createCanvas` helper + smoke cleanup

- **`packages/db/src/queries/canvas.ts`** — new
  `createCanvas(projectId): Promise<Canvas>` helper. Parallels the
  shape of `createWorkspace`, `createBrand`, `createProject`, etc.
  Previously the smoke script inserted canvases via
  `db.insert(canvases).values(...).returning()` because no helper
  existed; Phase 4 routes would have either duplicated that boilerplate
  or added the helper then anyway.
- **`packages/db/scripts/smoke.ts`** — swapped the direct insert for
  `await createCanvas(project.id)`. Removed now-unused `canvases` and
  `db` imports. Smoke still does the same flow; it's just shorter and
  uses the same surface Phase 4 will.

### LLM factory — documented type boundary

- **`packages/adapters/llm/src/factory.ts`** — added a short block
  comment above `defaultDeps` explaining the
  `as unknown as LanguageModel` cast: per-provider AI-SDK return
  types are structurally compatible with but not nominally equal to
  `LanguageModel`, so the cast is the intentional boundary between
  per-provider shapes and the AI-SDK core surface. Removes the
  "why is this cast here" question from future readers; revisit if
  AI-SDK exposes a direct helper for this conversion.

### Scaffold comments — `web` and `agent`

- **`packages/web/src/index.ts`** — `export {}` preserved, one-line
  comment added above: `// Scaffold. Real entry point (Vite + React)
  lands in Phase 7.`
- **`packages/agent/src/index.ts`** — same treatment with a Phase 5
  pointer. Stops the "is this broken or intentionally empty"
  confusion on first read.

### @types/node — explicit per-package devDeps

- Added `@types/node@^22.9.0` to the devDependencies of every
  workspace that declares `"types": ["node"]` in its tsconfig:
  `@brandfactory/db`, `@brandfactory/server`,
  `@brandfactory/adapter-auth`, `@brandfactory/adapter-storage`,
  `@brandfactory/adapter-realtime`, `@brandfactory/adapter-llm`.
  Previously these resolved via pnpm's hoisting of the root-level
  devDep, which worked but made the dependency implicit. Now the
  graph is self-describing: every package that imports `node:crypto`,
  `node:fs/promises`, `NodeJS.ProcessEnv`, etc. declares its node
  types dep directly. `@brandfactory/shared` deliberately skipped
  — its tsconfig doesn't list node types and its source doesn't
  import from `node:*`.

### Architecture doc — AuthProvider + BlobStore sketches

- **`docs/architecture.md`** — the ports sketch under
  `packages/adapters` now reflects the shipped Phase 3 surface:
  - `AuthProvider` is `verifyToken, getUserById` (was
    `verifyToken, getUser, listUsers`). Listing users is DB
    territory, not an identity-provider concern — spelled out in the
    body with a pointer to the Phase 3 completion record.
  - `BlobStore` is `put, get, delete, getSignedReadUrl,
    getSignedWriteUrl` (was `put, get, getSignedUrl, delete`) with
    a one-line note that signed URLs are the transport for both
    reads and writes, so the server can stay out of the byte path.
  This closes the "architecture doc updates owed" item in
  `docs/completions/phase3.md`.

### Verification

All green:

```
pnpm install       ✔
pnpm test          ✔  8 files, 34 tests pass
pnpm typecheck     ✔  9/9 workspaces pass
pnpm lint          ✔  0 problems (with type-aware + 3 new rules)
pnpm format:check  ✔  all files clean
```

Outstanding zod peer-dep warnings (`@ai-sdk/*`, `@openrouter/*`, `ai`,
`ollama-ai-provider` all want `zod@^3.x`; we run `zod@^4.3`) are
unchanged and documented in 0.4.0 — still harmless in our usage.

---

## 0.4.0 — 2026-04-19

First swappable port-and-adapter layer in the repo. Four
`@brandfactory/adapter-*` packages each export a port type plus the
default impls that satisfy it. `@brandfactory/server` reads a single
zod-validated env at boot and assembles the four adapters into a typed
bundle — no vendor name leaks past the adapter boundary. Realtime,
storage, and auth all surface dependency-injection seams so Phase 3 ships
the first real unit-test layer alongside the code (vitest, projects
mode, 31 tests across 8 files).

### Phase 3 execution plan — `docs/executing/phase-3-adapters.md`

- Expanded Phase 3 of the scaffolding plan into a file-by-file task
  list across nine tasks (shared envelope prerequisite, four adapter
  packages, server env loader + `buildAdapters`, root vitest setup,
  `.env.example`, smoke check).
- Locked fifteen design decisions up front: ports live in their adapter
  package (no new `core` workspace), `buildAdapters(env)` lives in
  `packages/server`, env validation lives in `packages/server/src/env.ts`
  and adapters never read `process.env` themselves, the LLM port returns
  an AI-SDK `LanguageModel` (no extra abstraction), the realtime port is
  pub/sub only with HTTP/WS upgrade deferred to Phase 4, the storage port
  surfaces signed URLs for both reads and writes (HMAC-SHA256 over
  `(method, key, exp)` for `local-disk`), `AuthProvider` collapses to
  `verifyToken` + `getUserById` only (`listUsers` dropped — DB territory,
  not identity-provider territory), settings are env-only in Phase 3,
  vitest is the project test runner, the WS framing schema lives in
  `@brandfactory/shared` (so `web` can speak the same protocol),
  per-provider config is discrete env vars validated with `superRefine`,
  vitest runs in projects mode with one root config + per-package configs,
  and deferred adapter impls are absent from code rather than throw-stubs
  (the `*_PROVIDER` enum narrows to shipped impls so a misconfigured env
  fails loudly at boot).
- Archived to `docs/archive/phase-3-adapters.md` on completion.

### Prerequisite shared addition — `packages/shared/src/realtime/envelope.ts`

Per locked decision 12, the WS framing schema lives in shared so both
`web` and `server` can validate the same protocol — adapter packages are
server-only and `web` cannot import from them.

- `RealtimeChannelSchema = z.string().min(1)` (intentionally loose for
  Phase 3; tighter naming convention lands when the server picks one).
- `RealtimeEventPayloadSchema = z.union([AgentEventSchema,
  CanvasOpEventSchema, PinOpEventSchema])`.
- `RealtimeClientMessageSchema` — browser → server: `subscribe |
  unsubscribe`, discriminated on `type`.
- `RealtimeServerMessageSchema` — server → browser: `event` (kept as a
  single-branch discriminated union so adding `error`/`ack` later is
  mechanical).
- Inferred types exported alongside; barrel re-export in
  `packages/shared/src/index.ts`.

### Phase 3 implementation — four adapter packages

Each adapter follows the same shape: `port.ts` declares the interface
and any error classes, one file per impl exports a factory function
(`createXxx(config, deps?)`) returning a plain object satisfying the
port, `index.ts` is a barrel that opens with a header comment listing
shipped *and* planned-but-not-yet-shipped impls so future intent
survives without runtime stubs.

- **`@brandfactory/adapter-auth`** —
  - Port: `verifyToken(token) → { userId }` + `getUserById(id) → User
    | null`. `User` is re-exported from `@brandfactory/db` so callers
    get one canonical row type. `InvalidTokenError` for any rejection.
  - `local`: dev-only, the bearer token IS the user id (uuid-validated
    via regex, then looked up via `@brandfactory/db.getUserById`).
    Token-as-id collapses crypto-free local dev into a single line of
    setup; production callers wire a real provider instead.
  - `supabase`: `jose.createRemoteJWKSet` + `jose.jwtVerify` against
    the project JWKS. `audience` and `issuer` optional. The `sub`
    claim becomes `userId`. A `jwks` test seam lets unit tests pass
    an in-memory key set instead of fetching one. Phase 3 does not
    sync Supabase Auth's `auth.users` back into our `users` table.

- **`@brandfactory/adapter-storage`** —
  - Port: `BlobStore` with `put | get | delete | getSignedReadUrl |
    getSignedWriteUrl`. Bodies accepted as `Uint8Array` or Node
    readable streams. `BlobNotFoundError` and `InvalidSignatureError`
    exposed.
  - `local-disk`: filesystem under `rootDir` with `mkdir -p` on each
    `put`. Path-traversal defense via `path.resolve` + a startsWith
    check against the resolved root (`../escape.bin` throws before any
    I/O). Signed URLs are HMAC-SHA256 over `${method}\n${key}\n${exp}`,
    hex-encoded, with a 15-minute default TTL. URL shape:
    `${publicBaseUrl}/${encodeURI(key)}?exp=<unix>&sig=<hex>`. A
    `verifySignature({ method, key, exp, sig, signingSecret, now? })`
    helper is exported for the Phase 4 server route — does an expiry
    check, recomputes the HMAC, and compares with
    `crypto.timingSafeEqual`. Constant-time + length-checked.
  - `supabase`: thin wrapper over `client.storage.from(bucket)`'s
    `upload | download | remove | createSignedUrl |
    createSignedUploadUrl`. A `client` dep injection seam keeps unit
    tests off the real `@supabase/supabase-js` fetch path.

- **`@brandfactory/adapter-realtime`** —
  - Port: `RealtimeBus` with `publish(channel, event) → Promise<void>`
    + `subscribe(channel, handler) → unsubscribe`. Event type imported
    from `@brandfactory/shared` (`AgentEvent | CanvasOpEvent |
    PinOpEvent`).
  - `native-ws`: in-process `Map<channel, Set<handler>>`. Empty sets
    are collected on unsubscribe. Handler exceptions are swallowed so
    one bad subscriber can't break fan-out (will surface via a logger
    in Phase 4).
  - `bindToNodeWebSocketServer(wss, { authenticate, authorize? })`
    wires a `ws.Server`'s `connection` event to per-client
    subscribe/unsubscribe handling. Failed `authenticate` →
    `socket.close(4401, 'unauthorized')`. Inbound frames are validated
    against `RealtimeClientMessageSchema` from shared. Outbound frames
    are typed as `RealtimeServerMessage`. Adapter does not own the
    HTTP upgrade — that lives in `packages/server` (Phase 4).

- **`@brandfactory/adapter-llm`** —
  - Port: `LLMProvider.getModel({ providerId, modelId }) →
    LanguageModel`, `LLMProviderId = 'openrouter' | 'anthropic' |
    'openai' | 'ollama'`, `LLMProviderConfig` (per-provider config
    blocks), `ProviderNotConfiguredError`. `LanguageModel` is `import
    type` from `ai` — no intermediate abstraction since Phase 5's
    `agent` package will consume AI-SDK directly.
  - `createLLMProvider(config, deps?)`: per-provider AI-SDK clients
    are constructed eagerly via `createAnthropic` / `createOpenAI` /
    `createOpenRouter` / `createOllama` and cached in a
    `Map<LLMProviderId, ProviderFactory>` so a long-running server
    doesn't rebuild on every `getModel` call. Exhaustiveness on
    `providerId` enforced by a `_exhaustive: never` default branch.
    API-key providers throw `ProviderNotConfiguredError` if the
    matching config block is missing; `ollama` is always callable
    (defaults to a local daemon, no key needed). Each `buildXxx` is a
    test seam — unit tests pass `vi.fn()` factories and never load
    the real SDK paths.

### Server env loader + `buildAdapters` — `packages/server`

- **`src/env.ts`** — one `EnvSchema = z.object({…}).superRefine(…)`.
  Required base fields: `DATABASE_URL`, the four `*_PROVIDER`
  selectors, `LLM_MODEL`. Optional per-provider fields are
  `.optional()` and promoted to required by `superRefine` based on
  which providers are active:
  - `AUTH_PROVIDER='supabase'` → `SUPABASE_JWKS_URL` required.
  - `STORAGE_PROVIDER='local-disk'` → `BLOB_LOCAL_DISK_ROOT` +
    `BLOB_SIGNING_SECRET` + `BLOB_PUBLIC_BASE_URL` required.
  - `STORAGE_PROVIDER='supabase'` → `SUPABASE_URL` +
    `SUPABASE_SERVICE_KEY` + `SUPABASE_STORAGE_BUCKET` required.
  - `LLM_PROVIDER='anthropic'|'openai'|'openrouter'` → matching
    `*_API_KEY` required. `LLM_PROVIDER='ollama'` requires nothing.
  - `LLM_PROVIDER_IDS` declared `as const satisfies readonly
    LLMProviderId[]` so a future enum widening in `adapter-llm` won't
    silently drift from this schema — TS fails the satisfies check.
  - `loadEnv(source = process.env)` returns the parsed `Env` or throws
    with a multi-line `path: message` summary of every issue.
- **`src/adapters.ts`** — `buildAdapters(env): { auth, storage,
  realtime, llm }` switches on each `*_PROVIDER` and calls the
  matching factory with the right env slice. Realtime is currently
  unconditional (only `native-ws` ships in Phase 3); adding a second
  impl widens the enum *and* the switch in lockstep, with the
  compiler enforcing exhaustiveness.

### Vitest setup — root + per-package projects mode

- Root `vitest.config.ts` declares `test.projects` pointing at the
  five tested workspaces (`adapters/{auth,storage,realtime,llm}` +
  `server`).
- Each project ships its own `vitest.config.ts` using `defineProject`
  with a `name` (so the runner labels output per package),
  `include: src/**/*.test.ts`, `environment: 'node'`. Per-package
  `pnpm --filter <pkg> test` continues to work, and so does the root
  `pnpm test`.
- `vitest@^2.1.8` added as a root devDep; root `test` script is now
  `vitest run` instead of the old `pnpm -r --parallel test`.

### `.env.example` — extended

Adapter selection (`AUTH_PROVIDER`, `STORAGE_PROVIDER`,
`REALTIME_PROVIDER`, `LLM_PROVIDER`, `LLM_MODEL`), the local-disk
trio (`BLOB_LOCAL_DISK_ROOT`, `BLOB_SIGNING_SECRET`,
`BLOB_PUBLIC_BASE_URL`), the Supabase set (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWKS_URL`,
`SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER`,
`SUPABASE_STORAGE_BUCKET`), and the LLM keys (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`,
`OLLAMA_BASE_URL`). Header comment explains that `*_PROVIDER` picks
which adapter the server wires up at boot.

### Smoke check — unit tests across the adapter layer

Per the scaffolding plan, Phase 3's smoke is **unit tests per
adapter**, not an end-to-end. Test counts (all green):

- `adapter-auth/local.test.ts` — 4 tests: uuid happy path, non-uuid
  rejection, missing-user rejection, getUserById delegation. Uses an
  injected `getUserById` so no DB is touched.
- `adapter-auth/supabase.test.ts` — 3 tests: mints RS256 keys via
  `jose.generateKeyPair`, verifies a valid token decodes to the right
  `sub`, expired tokens reject, no-`sub` tokens reject. JWKS provided
  via the test seam — no real Supabase or network.
- `adapter-storage/local-disk.test.ts` — 6 tests: round-trips
  put/get/delete in a `mkdtemp` root, asserts traversal rejection,
  signs/verifies a read URL, rejects expired and tampered sigs,
  asserts a PUT-signed URL doesn't verify as GET.
- `adapter-storage/supabase.test.ts` — 2 tests: hand-rolled fake
  client verifies the adapter calls the right SDK methods with the
  right args, including content-type passing on writes.
- `adapter-realtime/native-ws.test.ts` — 4 tests: spins up a real
  `http.Server` + `ws.Server` on an ephemeral port and verifies
  in-process publish/subscribe + idempotent unsubscribe, fan-out to
  two real WS clients on the same channel, over-the-wire unsubscribe
  stops further delivery, and `authenticate() → null` closes the
  socket with code `4401`.
- `adapter-llm/factory.test.ts` — 5 tests: caching (one
  `buildAnthropic` call across two `getModel` calls), modelId
  passing, openrouter `baseURL` plumbing, ollama-with-no-config, and
  the `ProviderNotConfiguredError` path.
- `server/env.test.ts` — 6 tests: local happy path, supabase happy
  path, and four conditional-required failure paths
  (`SUPABASE_JWKS_URL`, `BLOB_SIGNING_SECRET`, `ANTHROPIC_API_KEY`,
  ollama-with-no-key).
- `server/adapters.test.ts` — 1 test: `loadEnv` + `buildAdapters` for
  the local + native-ws + openrouter combo, asserts the returned
  bundle has the four expected method shapes.

### Cross-cutting changes outside the adapter packages

- **`packages/shared`** — new `src/realtime/envelope.ts` + barrel
  re-export. No other shared changes.
- **`packages/db/src/client.ts`** — `pool` and `db` are now lazy
  `Proxy`-wrapped singletons. The `DATABASE_URL` check moved from
  module-import time to first-access time. Required because vitest
  setup files run *after* module evaluation, so import-time `throw`s
  cannot be neutralized by a sentinel value. Real callers see
  identical behavior (still throws on first query if env isn't set);
  test-time imports for type-only consumers no longer fail.
- **Root `package.json`** — `vitest@^2.1.8` added to devDeps; root
  `test` script now runs `vitest run` instead of the old
  `pnpm -r --parallel test` recursion.
- **Root `vitest.config.ts`** — new file, declares projects mode.

### Architecture doc updates owed

Per locked decision 10, `docs/architecture.md` originally sketched
`AuthProvider` with `listUsers`. The Phase 3 port drops that method —
listing users is `@brandfactory/db` territory, not an identity
concern. Update needed: amend the AuthProvider port sketch in
`docs/architecture.md` and link to the Phase 3 completion record.

### API notes worth remembering

- **Zod 4 vs AI-SDK peer:** the AI-SDK provider modules declare a
  peer dependency on `zod@^3.x`; this repo runs `zod@^4.3`. pnpm
  warns; the `LanguageModel` type we re-export is a plain TS
  interface and isn't zod-derived, so the version skew is harmless
  in our usage. If we ever consume a zod schema *exported* by an
  AI-SDK module, revisit.
- **`ws@8` `connection` handler:** delivers `(socket, req:
  IncomingMessage)`; we read the request from the second arg for
  `authenticate`. Header-based auth (e.g.
  `Sec-WebSocket-Protocol: bearer.<token>`) belongs in the
  user-supplied `authenticate` callback, not in the bus.
- **HMAC URL format choice:** `${method}\n${key}\n${exp}` was picked
  because newlines aren't valid in any of the inputs and the format
  is trivially debuggable (`echo -ne "GET\nfoo\n123" | openssl dgst
  -sha256 -hmac secret`). Verifier and signer share a single
  source-of-truth function.
- **`jose.generateKeyPair('RS256')`** returns `KeyLike`
  (`CryptoKey | KeyObject`); the supabase auth test signs with
  `KeyLike` rather than `CryptoKey` to avoid pulling the DOM lib
  into our node-only tsconfig.
- **Vitest projects mode requires per-package configs.** Vitest 2
  needs a `vitest.config.ts` at each project root (or an inline
  config). Per-package configs also let `web` later pick
  `environment: 'jsdom'` without polluting the rest.

### Phase 3 completion record — `docs/completions/phase3.md`

Phase-level wrap with per-task notes inline (Phase 3's surface area
was tighter than Phase 2; one document is enough). Captures the
fifteen locked design decisions delivered as specified, every
adapter's port + impl + test detail, the cross-cutting changes
outside the adapter packages (shared envelope, db client lazy
singleton, root vitest config, root `package.json` test script), the
architecture-doc TODO around `listUsers`, and the API quirks worth
remembering. Also documents what Phase 3 explicitly did *not* include
(HTTP server / routes / middleware / WS upgrade endpoint / blob HTTP
routes / workspace-level LLM settings / agent prompt assembly /
Supabase Auth ↔ users sync / API-key encryption at rest / e2e — all
per the plan's exclusion list).

### Verification

All green on a fresh install:

```
pnpm install       ✔
pnpm test          ✔  8 files, 31 tests pass
pnpm typecheck     ✔  9/9 workspaces pass
pnpm lint          ✔  0 problems
pnpm format:check  ✔  all files clean
```

The Phase 2 `db smoke` script was not re-run in this session because
Docker wasn't available locally. The `client.ts` lazy-singleton
refactor preserves the runtime contract (still throws on first DB
access if `DATABASE_URL` is unset); the Phase 3 unit tests exercise
the import-without-DB paths that previously broke.

---

## 0.3.0 — 2026-04-18

First database layer in the repo. `@brandfactory/db` is the typed,
migration-driven Postgres package every backend concern will build
against: drizzle-orm over `pg`, schema mirrors `@brandfactory/shared`,
ids are real `uuid` columns while shared keeps its branded-string types
at the type layer. A one-shot smoke script walks a real user →
workspace → brand → project → canvas → block → event flow end-to-end
against a docker-compose Postgres.

### Phase 2 execution plan — `docs/executing/phase-2-database-package.md`

- Expanded Phase 2 of the scaffolding plan into a file-by-file task
  list across seven tasks (package setup, connection, schema, queries,
  local-dev compose, barrel, smoke).
- Locked nine design decisions up front: pins collapse to a boolean
  on `canvas_blocks` (no `pins` table), block kinds drop to
  `text | image | file` (no `snippet`), every block carries
  `createdBy` provenance, canvas blocks use `deleted_at` soft-delete,
  guideline sections are normalized to their own table, one canvas
  per project (unique constraint), `agent_messages` deferred to
  Phase 6, ids are `uuid defaultRandom()`, timestamps are
  `timestamptz` with pgEnums for stable value sets.
- Enumerated open questions with leanings (enum volatility,
  `canvas_events.block_id` FK, position rebalancing, canvas-per-
  project cardinality, event payload shape) so execution had clear
  defaults.
- Archived to `docs/archive/phase-2-database-package.md` on
  completion.

### Prerequisite shared amendments — `packages/shared`

Small, localized patch to line shared up with the locked DB shape
before any Drizzle file was written.

- `project/canvas.ts` — `SnippetCanvasBlockSchema` dropped from the
  union. `PinIdSchema` / `PinCreatedBySchema` / `PinSchema` removed
  entirely (pins are a block boolean now, not a row). `CanvasBlockKind`
  → `z.enum(['text', 'image', 'file'])`. `CanvasBlockBaseShape` gained
  `isPinned`, `pinnedAt`, `createdBy`, `deletedAt`. `ShortlistView`
  stays — still a derived projection, now computed from
  `is_pinned = true AND deleted_at IS NULL`.
- `ids.ts` — `PinIdSchema` / `PinId` removed.
- `agent/events.ts` — `CanvasOpSchema` payloads no longer carry
  `SnippetCanvasBlock`; `PinOpSchema` stays (pin / unpin ops still
  flow on the stream) but no longer references `PinSchema`.

### Phase 2 implementation — `packages/db`

Seven source files under `src/schema/`, six under `src/queries/`, one
mapper module, one client, one barrel.

- **Package setup.** `package.json` pulls `drizzle-orm` + `pg` as
  runtime deps and `drizzle-kit` + `@types/pg` + `tsx` as dev deps.
  Scripts: `db:generate`, `db:migrate`, `db:studio`, `smoke`, plus
  the usual `lint` / `typecheck` / `format:check`. `tsconfig.json`
  extends the base with `rootDir: .` and `outDir: dist` so scripts
  and src compile together. `drizzle.config.ts` reads
  `DATABASE_URL`, points at `src/schema/**/*.ts` → `drizzle/`.
- **Connection module.** `src/client.ts` — reads `DATABASE_URL`
  (throws if missing), constructs a singleton pg `Pool`, and exports
  `db = drizzle(pool, { schema })` so the drizzle query builder is
  typed end-to-end against the schema map.
- **Schema (8 tables, 6 pgEnums).**
  - `users` — `id`, `email` (unique), `display_name` (nullable),
    timestamps. V1 stub to own workspaces and be the FK target for
    `canvas_events.user_id`; real auth columns land with Phase 3.
  - `workspaces` — `owner_user_id` FK → users `ON DELETE restrict`,
    index on `(owner_user_id)`.
  - `brands` — `workspace_id` FK `ON DELETE cascade`, index on
    `(workspace_id)`.
  - `guideline_sections` — FK to brand, `label`, `body` (jsonb —
    ProseMirror doc), integer `priority`, `createdBy` pgEnum,
    timestamps. Index on `(brand_id, priority)` for ordered reads.
  - `projects` — `kind` pgEnum (`freeform | standardized`),
    `template_id text nullable` (app-layer enforces non-null when
    `kind = 'standardized'`), FK to brand.
  - `canvases` — `project_id` FK + **unique** (one canvas per
    project in V1).
  - `canvas_blocks` — one wide table with nullable per-kind columns
    (`body`, `blob_key`, `alt`, `width`, `height`, `filename`,
    `mime`) rather than table-per-kind, matching shared's
    discriminated union. Carries `is_pinned` / `pinned_at`,
    `created_by`, `deleted_at`, integer `position`. Three partial
    indexes: active layout
    `(canvas_id, position) WHERE deleted_at IS NULL`, shortlist
    `(canvas_id) WHERE deleted_at IS NULL AND is_pinned = true`,
    and `(canvas_id, deleted_at)` for housekeeping.
  - `canvas_events` — append-only. FK to canvas, `block_id uuid`
    **without FK** (log survives any future hard-delete path), op
    + actor pgEnums, `user_id` FK `ON DELETE set null`, `payload`
    jsonb. Only `created_at` — no `updated_at`. Indexes:
    `(canvas_id, created_at desc)` for the canvas timeline and
    `(block_id, created_at desc) WHERE block_id IS NOT NULL` for
    per-block history.
- **Mappers.** `src/mappers.ts` — row → shared-type converters for
  workspaces, brands, guideline sections, projects, canvases, and
  canvas blocks. `rowToProject` discriminates on `kind`; throws on a
  null `template_id` when kind is `standardized`. `rowToCanvasBlock`
  reconstructs the discriminated union on read and throws on missing
  per-kind columns — a loud data-integrity signal, not a silent
  fallback.
- **Query helpers (18, grouped by aggregate).** Dumb CRUD, no
  business rules. Inputs typed against `@brandfactory/shared` where
  they map 1:1, returns flow back through the mappers.
  - `users.ts` — `getUserById`, `getUserByEmail`, `createUser`.
    `User` type exposed as the inferred row (shared doesn't model
    users yet).
  - `workspaces.ts` — `getWorkspaceById`, `listWorkspacesByOwner`,
    `createWorkspace`.
  - `brands.ts` — `getBrandById`, `listBrandsByWorkspace`,
    `createBrand`, `listSectionsByBrand`, `upsertSection` (update
    when `id` supplied, insert otherwise), `reorderSections`
    (wrapped in a single transaction).
  - `projects.ts` — `getProjectById`, `listProjectsByBrand`,
    `createProject` with a distributive union input so
    `standardized` projects carry `templateId` at the type level.
  - `canvas.ts` — `getCanvasByProject`, `listActiveBlocks`,
    `createBlock` (switches on `kind` to build the insert payload),
    `updateBlock`, `softDeleteBlock`, `restoreBlock`, `setPinned`
    (stamps / clears `pinned_at`), `getShortlistView` (joins
    `canvases` to filter by `projectId` and returns
    `ShortlistView`).
  - `events.ts` — `appendCanvasEvent`, `listCanvasEvents` (supports
    `since` + `limit`, `desc(created_at)`), `listBlockEvents`
    (`asc(created_at)`, carries `IS NOT NULL` so the partial index
    on `block_id` is usable).
- **Barrel.** `src/index.ts` re-exports `db`, `pool`, the full
  schema barrel, and every query module.

### Local dev Postgres — `docker/` + repo-root `.env.example`

- `docker/compose.yaml` — single `postgres:16` service,
  `brandfactory`/`brandfactory`/`brandfactory`
  user/password/database, port 5432, named volume
  `postgres_data`, `pg_isready` healthcheck.
- `docker/README.md` — one paragraph: `up -d postgres` to start,
  `down -v` to nuke.
- Repo-root `.env.example` — single `DATABASE_URL` line matching
  the compose credentials. Also documents that drizzle-kit does
  not auto-load `.env` — export or prefix the command.
- `.prettierignore` — excludes `packages/*/drizzle/` so generated
  migration artifacts don't fail `format:check`.

### Smoke check — `packages/db/scripts/smoke.ts`

Runs end-to-end against the docker Postgres after `db:generate` +
`db:migrate`. Creates a user, workspace, brand, two guideline
sections, a freeform project, a canvas (direct insert — no
`createCanvas` helper yet), a pinned text block, appends
`add_block` + `pin` events, asserts the shortlist contains exactly
one block, soft-deletes it, appends `remove_block`, asserts
shortlist empty, and finally asserts
`listBlockEvents` returns `[add_block, pin, remove_block]` in
chronological order. Closes the pool in `finally`. Exits 0 on
success, non-zero on assertion failure. Idempotent re-runs aren't
a goal — canonical reset is `docker compose down -v`.

### Drizzle / pg API notes

- `pgTable` third argument is an array (`(table) => [...]`) in
  drizzle-orm 0.36, not the object form from older releases.
- Partial indexes use `.where(sql\`…\`)` on the index builder —
  generates the `WHERE …` clause verbatim in the migration SQL.
- `timestamp(..., { withTimezone: true, mode: 'string' })` gives
  `timestamptz` columns that round-trip as ISO-8601 strings, which
  is what `z.iso.datetime()` in shared already expects.
- `pgEnum` values land as a real `CREATE TYPE` in the migration;
  adding a value later is a one-liner (`ALTER TYPE ADD VALUE`),
  removing a value is not — that trade-off is accepted for the
  value sets defined here.
- `defaultRandom()` on a `uuid` column compiles to
  `DEFAULT gen_random_uuid()`; Postgres 13+ has it built in, no
  `pgcrypto` extension required.

### Phase 2 completion record — `docs/completions/phase2.md`

Phase-level wrap with per-task records (`phase2-task1.md`
through `phase2-task7.md`). Captures the nine locked design
decisions delivered as specified, how each open question landed
(enums kept as `pg_enum`, no FK on `canvas_events.block_id`,
position rebalancing deferred until first collision, strict 1:1
canvas-per-project, plain jsonb event payloads validated at the
app layer), and the cross-cutting changes outside `packages/db`
(shared amendments, docker compose, repo `.env.example`,
`.prettierignore`). Also documents what Phase 2 explicitly did
*not* include (no auth / realtime / HTTP routes / agent_messages /
seed data / multi-service compose / RLS — all per the plan's
exclusion list) and the three intentional omissions from the
plan itself: no build pipeline (exports `src/index.ts` directly,
matching every other `workspace:*` package), no `createCanvas`
helper (the plan's Task 4 list didn't include it), no
parse-at-boundary runtime validation on reads (casts suffice for
trusted rows; Phase 9 hardening owns that call).

### Verification

All green against a running docker-compose Postgres:

```
pnpm install                                   ✔
pnpm -F @brandfactory/db db:generate           ✔   8 tables → 0000_eager_deathstrike.sql
pnpm -F @brandfactory/db db:migrate            ✔   applied cleanly
psql \dt                                       ✔   8 tables present
pnpm -F @brandfactory/db smoke                 ✔   smoke: OK (all assertions pass)
pnpm lint                                      ✔   0 problems
pnpm typecheck                                 ✔   9/9 workspaces pass
pnpm format:check                              ✔   all files clean
```

---

## 0.2.0 — 2026-04-18

First runtime code in the repo. `@brandfactory/shared` is now the wire
contract every other package builds against: schema-first with zod, types
inferred, zero business logic, one runtime dep (`zod ^4.3.6`). Both
`packages/server` and `packages/web` depend on it via `workspace:*` and
successfully parse a `BrandSchema` payload end-to-end.

### Phase 1 execution plan — `docs/executing/phase-1-shared-package.md`

- Expanded Phase 1 of the scaffolding plan into a concrete, methodical
  file-by-file task list before any code was written.
- Locked five design decisions up front: brand guidelines are fully
  dynamic (no category enum), sections are normalized (their own table in
  Phase 2), suggested categories ship as seed data, section body =
  ProseMirror/TipTap JSON, concurrency v1 = section-level last-write-wins.
- Enumerated open questions with leanings (`createdBy` on sections,
  integer `priority`, derived `ShortlistView`) so execution had clear
  defaults.

### Phase 1 implementation — `packages/shared`

Nine source files under `src/`, grouped by domain, behind a single barrel.

- **Primitives.** `json.ts` — recursive `JsonValue` + `ProseMirrorDoc`
  alias (typed as generic JSON at the schema boundary; TipTap enforces
  ProseMirror validity client-side). `ids.ts` — `brandedId<TBrand>()`
  helper plus eight concrete branded ids (`BrandId`, `WorkspaceId`,
  `ProjectId`, `CanvasId`, `CanvasBlockId`, `PinId`, `SectionId`,
  `UserId`). Runtime is a plain string; the compile-time type is nominal
  so `BrandId` and `ProjectId` are not interchangeable.
- **Workspace.** `workspace/workspace.ts` — `id`, `name`, `ownerUserId`,
  timestamps. No membership/permissions until multi-user flows land.
- **Brand + guidelines.** `brand/brand.ts` exports three schemas:
  `BrandSchema` (the row, no embedded sections), `BrandSummarySchema`
  (`pick` projection for list/picker surfaces) and
  `BrandWithSectionsSchema` (API-level join shape).
  `brand/guideline-section.ts` — fully user-defined sections:
  free-text `label`, `body: ProseMirrorDoc`, sparse-integer `priority`,
  `createdBy: 'user' | 'agent'`, timestamps. No hardcoded category enum.
  `brand/suggested-categories.ts` — static `SUGGESTED_SECTIONS` seed
  (Voice & tone, Target audience, Values & positioning, Visual guidelines,
  Messaging frameworks) rendered by the frontend as a starter picker.
  Data, not schema.
- **Project + canvas.** `project/project.ts` — discriminated union on
  `kind`: `freeform` vs `standardized` (with `templateId`).
  `project/canvas.ts` — `CanvasSchema` container, `CanvasBlockSchema`
  4-way discriminated union (`text`, `image`, `file`, `snippet`),
  `PinSchema`, and `ShortlistViewSchema` as a derived projection
  (not a stored entity). Base shapes are plain TS object literals spread
  into each branch, keeping zod's discriminated-union fast path intact.
- **Agent event stream.** `agent/events.ts` — `AgentMessageSchema`,
  `AgentToolCallSchema`, `CanvasOpSchema` (add-block / update-block /
  remove-block), `PinOpSchema` (pin / unpin), event-stream envelopes
  (`CanvasOpEventSchema`, `PinOpEventSchema`) and the outer
  `AgentEventSchema`. The outer union uses `z.union` rather than
  `z.discriminatedUnion` because two branches wrap an inner discriminated
  union on `op` — a pattern zod's discriminated-union fast path doesn't
  accept.
- **Conventions.** Schema-first with `z.infer` types, `z.iso.datetime()`
  at every timestamp, no defaults, no business logic, no validators or
  guards. ESM-only, zero runtime deps beyond `zod`.

### Consumer wiring

- `packages/server` and `packages/web` each gained
  `@brandfactory/shared: workspace:*` as a dependency. These wire-ups
  would have been needed by Phases 4 / 7 anyway; landing them now let the
  smoke check actually exercise the cross-package `import`.

### Zod 4 API notes

- Datetimes use `z.iso.datetime()` (zod 4 form; the v3 `z.string().datetime()`
  still works but is deprecated).
- Integers use `z.number().int()` — universal across zod 4 minor
  versions, no behaviour difference vs the top-level `z.int()` helper.
- `z.record(z.string(), V)` — zod 4 requires both key and value schemas.

### Phase 1 completion record — `docs/completions/phase1.md`

Full record of what was written, where, and why. Includes the five
locked design decisions, the plan's open questions resolved with
justification, and the in-flight refinements to the execution plan
(`ProjectBase` / `CanvasBlockBase` as plain object literals,
`AgentEventSchema` as `z.union`, `BrandSummary` added as a `pick`
projection, `GuidelineSectionCreatedBySchema` / `PinCreatedBySchema`
exported as separate enums to hedge against future divergence). Also
documents the cross-package `BrandSchema.parse(...)` probe and what
Phase 1 explicitly does *not* include (Drizzle schema, curation UI,
Yjs/CRDT, prompt assembly, validators).

### Verification

All green on a fresh install:

```
pnpm install       ✔
pnpm lint          ✔  0 problems
pnpm typecheck     ✔  9/9 workspaces pass
pnpm format:check  ✔
```

End-to-end probe: `BrandSchema.parse(...)` round-trips from both
`packages/server/src/index.ts` and `packages/web/src/index.ts` against
a literal payload, typed with the inferred `Brand`. Probe reverted after
verification — the runtime code still lives only in `packages/shared`.

---

## 0.1.0 — 2026-04-18

First tagged milestone. Lays the conceptual and structural groundwork for
every phase that follows. No runtime code yet — the repo installs, lints,
and typechecks on a flat pnpm workspaces skeleton.

### Vision & product docs

- **`docs/vision.md`** — full product vision. Brand as single source of
  truth; workspaces; projects (freeform and standardized templates); the
  universal Ideate → Iterate → Finalize loop; split-screen agent + canvas
  surface; who it's for; what's explicitly out of scope.
- **`docs/highlevel-vision.md`** — condensed one-pager version of the
  above, intended for README-style contexts.
- **`docs/ref/example-brand-wikis.md`** — reference material for brand
  guideline shapes we want to support.

### Architecture blueprint — `docs/architecture.md`

- Stack decision: **Vite + React + TS** (frontend), **Node + Hono + TS**
  (backend), **Drizzle on any Postgres** (Supabase as default adapter),
  **Vercel AI SDK** with **OpenRouter + Anthropic native + Ollama + OpenAI**
  as simultaneously-available LLM providers, selectable per workspace from
  a frontend settings page.
- Repo shape: flat `packages/*` monorepo (no `apps/` vs `packages/`
  split), scoped names `@brandfactory/*`, adapter sub-grouping under
  `packages/adapters/*`.
- Module boundaries documented for `shared`, `db`, `agent`, and
  `adapters`. `packages/agent` is explicitly **backend-only** — consumed
  by `server`, not by `web`. The wire contract (event shapes, tool-call
  signatures) lives in `packages/shared`.
- Ports-and-adapters pattern spelled out with concrete LLM/storage/auth
  examples. Domain code depends on the capability, not the vendor.
- Data-flow walkthrough, self-hosting story, extensibility surface, and
  pending decisions (auth for non-Supabase deployments, canvas conflict
  resolution, agent in-process vs worker, LLM settings storage).

### Scaffolding implementation plan — `docs/executing/scaffolding-plan.md`

- 10 phases (0 – 9) from repo foundation to hardening pass.
- Each phase defines a concrete outcome, a checkboxed task list, and a
  smoke check so it's unambiguous when the phase is done.
- Phases named by target directory (`packages/server`, `packages/web`)
  rather than `apps/` to match the flat layout.
- Explicit non-goals for the scaffolding effort (standardized templates,
  public shareable pages, CRDT collaboration, integrations, billing) so
  we don't scope-creep the foundation.

### Phase 0 implementation — repo foundation

Everything required to `pnpm install && pnpm lint && pnpm typecheck` on a
fresh clone.

- **Root tooling:** `package.json` (scripts: `dev`, `build`, `lint`,
  `lint:fix`, `format`, `format:check`, `typecheck`, `test`, `prepare`),
  `pnpm-workspace.yaml`, `.nvmrc` (Node 20 LTS floor), `.editorconfig`,
  `.gitignore`, `.gitattributes`, `.prettierrc`, `.prettierignore`
  (`docs/` excluded so authored prose isn't auto-rewrapped),
  `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` +
  `verbatimModuleSyntax` + `isolatedModules`), root `tsconfig.json`,
  `eslint.config.js` (ESLint 9 flat config: `@eslint/js` recommended →
  `typescript-eslint` recommended → `eslint-config-prettier`),
  `.husky/pre-commit` running `pnpm lint-staged` on commit,
  `scripts/dev.sh` placeholder.
- **9 peer workspaces** created with matching `package.json` +
  `tsconfig.json` + `src/index.ts` stubs: `@brandfactory/web`,
  `@brandfactory/server`, `@brandfactory/shared`, `@brandfactory/db`,
  `@brandfactory/agent`, `@brandfactory/adapter-auth`,
  `@brandfactory/adapter-storage`, `@brandfactory/adapter-realtime`,
  `@brandfactory/adapter-llm`.
- **Dev tooling pinned:** ESLint 9, Prettier 3, TypeScript 5.6,
  typescript-eslint 8, husky 9, lint-staged 15, `@types/node` 22. No
  runtime dependencies yet — those land with the phases that need them.

### Phase 0 completion record — `docs/completions/phase0.md`

Full record of what was written, where, and why, including decisions
made during execution (e.g. deferring TypeScript project references,
excluding `docs/` from Prettier, keeping pre-commit fast by leaving
`tsc` out of the hook). Also lists what Phase 0 explicitly does *not*
include so Phase 1 can land without ambiguity.

### Verification

All green on a fresh install:

```
pnpm install       ✔
pnpm lint          ✔  0 problems
pnpm typecheck     ✔  9/9 workspaces pass
pnpm format:check  ✔
```
