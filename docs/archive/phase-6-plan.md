# Phase 6 — `POST /projects/:id/agent`

Goal: land the first end-to-end streaming agent call. A `curl` against the new
route returns an SSE stream of `AgentEvent`s; canvas mutations made by the
model are persisted, broadcast on the realtime bus, and visible on a
subsequent `GET /projects/:id`. Assistant and user messages are persisted so
the next turn carries context.

This plan assumes 0.6.1 as the starting point (post-Phase-5, post-hardening).
Scaffolding reference: [./scaffolding-plan.md](./scaffolding-plan.md) § Phase 6.

---

## What's already in place (don't rebuild)

- **`@brandfactory/agent`** — `streamResponse(input): AsyncIterable<AgentEvent>`
  composes system prompt + canvas context, runs `streamText`, and yields typed
  events. Side effects flow through an injected `CanvasOpApplier` with three
  methods (`addCanvasBlock`, `pinBlock`, `unpinBlock`). See
  `packages/agent/src/stream.ts:21` and `packages/agent/src/tools/applier.ts:16`.
- **`@brandfactory/adapter-llm`** — `LLMProvider.getModel({ providerId, modelId })`
  returns an AI-SDK `LanguageModel`. `streamResponse` takes the provider + a
  `LLMProviderSettings` object and does the `getModel` call itself.
- **`@brandfactory/adapter-realtime`** — `RealtimeBus.publish(channel, event)`
  and `.subscribe(channel, handler)`. Channel convention: `project:<uuid>`,
  `brand:<uuid>`, `workspace:<uuid>`.
- **`@brandfactory/db`** — canvas queries (`listActiveBlocks`, `createBlock`,
  `setPinned`, `getShortlistView`), canvas event log (`appendCanvasEvent`,
  `listCanvasEvents`), brand + sections, workspace settings. **No
  `agent_messages` table yet** — this phase adds it.
- **`@brandfactory/server`** — Hono app with request-id → logger → auth →
  onError middleware. `requireProjectAccess(userId, projectId, db)` returns
  `{ project, brand, workspace }`. `resolveLLMSettings(workspaceId, env, db)`
  merges workspace override with env defaults. Realtime bus mounted at `/rt`.

## Non-goals (explicitly deferred)

- Image/file canvas tool variants. The applier speaks only `text` blocks; the
  Phase-5 `AddCanvasBlockInput` union is `{ kind: 'text' }` only. Image/file
  need a blob-upload flow first.
- Client-side consumption (`useChat`, TipTap apply). Phase 7.
- Durable rate-limiting. In-memory per-process concurrency guard is enough for
  self-hosted; a Redis-backed limiter is a later concern.
- Token budgeting / context-window trimming. The canvas-context unpinned
  truncation (`CANVAS_CONTEXT_UNPINNED_LIMIT = 20`) and message-history cap
  (step 6 below) are crude but sufficient for v1.
- Reasoning / source / file stream parts. `streamResponse` already ignores
  them; the route does nothing extra.

---

## Step 1 — `agent_messages` table in `@brandfactory/db`

**Outcome:** a persistent store for `AgentMessage` rows keyed to a project,
with rows in turn order. Drives conversation continuity across turns and the
"persist user + assistant on completion" requirement from scaffolding § Phase 6.

Shape:

```ts
export const agentMessageRole = pgEnum('agent_message_role', ['user', 'assistant'])

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: agentMessageRole('role').notNull(),
  content: text('content').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => ({
  projectCreatedIdx: index('agent_messages_project_created_idx').on(t.projectId, t.createdAt),
}))
```

Design notes:

- **Why a new table, not `canvas_events`.** Canvas events model *canvas
  mutations*; assistant replies without tool calls (a common case) produce no
  canvas event, so reusing that table would mean mixing semantics or missing
  rows. Keep them separate.
- **`content` as `text`, not `jsonb`.** v1 `AgentMessage.content` is a plain
  string (see `packages/shared/src/agent/events.ts`). If we later move to
  structured assistant content (reasoning, citations, mixed parts), migrate to
  `jsonb` then — no speculative columns today.
- **`userId` nullable + `set null` on delete.** Assistant rows have no user;
  user rows survive account deletion as historical record.
- **`(project_id, created_at)` index.** All reads are "last N messages for
  project" in insert order.

### Files

- `packages/db/src/schema/agent_messages.ts` — new. Mirrors the structure of
  `schema/canvas_events.ts`.
- `packages/db/src/schema/index.ts` — re-export the new table.
- `packages/db/migrations/NNNN_agent_messages.sql` — generated via
  `pnpm --filter @brandfactory/db db:generate`. Do **not** hand-author; let
  drizzle-kit produce it so the snapshot stays consistent. Expect:
  - `CREATE TYPE agent_message_role AS ENUM ('user', 'assistant');`
  - `CREATE TABLE agent_messages (…);`
  - `CREATE INDEX agent_messages_project_created_idx ON agent_messages (project_id, created_at);`
- `packages/db/src/mappers.ts` — add `rowToAgentMessage(row)`. `content` is
  plain text so no `safeParse` needed, but normalize `createdAt` to ISO string.
- `packages/db/src/queries/agent-messages.ts` — new. Two helpers:
  ```ts
  export async function listAgentMessages(
    projectId: ProjectId,
    opts?: { limit?: number },
  ): Promise<AgentMessage[]>
  export async function appendAgentMessage(input: {
    projectId: ProjectId
    role: 'user' | 'assistant'
    content: string
    userId?: UserId | null
  }): Promise<AgentMessage>
  ```
  `listAgentMessages` orders by `createdAt ASC` (oldest first — `streamText`
  expects chronological order), with `limit` defaulting to `40` applied
  *inside* the query (use a subquery to pick the latest N then reverse).
- `packages/db/src/index.ts` — re-export the new queries.

### Tests

Extend `packages/db/src/mappers.test.ts`: one case for the happy-path mapper.
A live-DB integration test for the queries is **deferred** (the package still
has no vitest DB harness; the smoke script covers it — see 0.6.1 deferred
list). Instead, exercise them indirectly via the route tests (step 7).

---

## Step 2 — Expose the new queries on the server's `Db` facade

**Outcome:** `deps.db.appendAgentMessage(...)` and `deps.db.listAgentMessages(...)`
are callable from routes.

### Files

- `packages/server/src/db.ts` — add both functions to the `Db` interface and
  to the `createDb()` / real-bindings map. Same one-line-per-helper pattern as
  the existing entries.
- `packages/server/src/test-helpers.ts` — add no-op stubs to the default
  `testDb` (route tests that don't touch the agent route pass `[]` / `undefined`
  and never call them). For the agent-route tests, build a small in-memory
  `Map<projectId, AgentMessage[]>` so assertions can inspect persisted rows.

No DB change, no test case of its own.

---

## Step 3 — `createDbRealtimeApplier` — the `CanvasOpApplier` used by the route

**Outcome:** a factory that returns a `CanvasOpApplier` whose three methods
mutate via `@brandfactory/db` and publish on the realtime bus.

File: `packages/server/src/agent/applier.ts` (new).

```ts
import type { CanvasOpApplier, AddCanvasBlockInput } from '@brandfactory/agent'
import type { CanvasBlock, CanvasBlockId, CanvasId, ProjectId, UserId } from '@brandfactory/shared'
import type { Db } from '../db'
import type { RealtimeBus } from '@brandfactory/adapter-realtime'
import type { Logger } from '../logger'

export interface DbRealtimeApplierDeps {
  db: Db
  realtime: RealtimeBus
  projectId: ProjectId
  canvasId: CanvasId
  userId: UserId
  log: Logger
}

export function createDbRealtimeApplier(deps: DbRealtimeApplierDeps): CanvasOpApplier {
  const channel = `project:${deps.projectId}`

  return {
    async addCanvasBlock(input: AddCanvasBlockInput): Promise<CanvasBlock> {
      const block = await deps.db.createBlock({
        canvasId: deps.canvasId,
        kind: 'text',
        body: input.body,
        position: input.position,
        createdBy: 'agent',
      })
      await deps.db.appendCanvasEvent({
        canvasId: deps.canvasId,
        blockId: block.id,
        op: 'add_block',
        actor: 'agent',
        userId: deps.userId,
        payload: { op: 'add-block', block },
      })
      await deps.realtime.publish(channel, { kind: 'canvas-op', op: { op: 'add-block', block } })
      return block
    },
    async pinBlock(blockId: CanvasBlockId): Promise<CanvasBlock> { /* …setPinned(true) + appendCanvasEvent('pin') + publish pin-op… */ },
    async unpinBlock(blockId: CanvasBlockId): Promise<CanvasBlock> { /* …mirror of pin… */ },
  }
}
```

Design notes:

- **Ordering: DB write → event append → realtime publish.** A crashed publish
  leaves a persisted mutation but no live fan-out — clients refetching on
  reconnect see truth. The reverse would be strictly worse (phantom events for
  un-persisted state).
- **No transaction across the three.** The DB helper `createBlock` is atomic;
  `appendCanvasEvent` is a separate row, by design (the event log is append-only
  and replay-safe — a missing event for an existing block is no worse than
  today's un-logged user writes, which we also don't wrap). If we ever promote
  the event log to the source of truth, revisit.
- **`CanvasOpEvent` / `PinOpEvent` shape.** Matches
  `packages/shared/src/agent/events.ts`. The realtime bus's `publish` signature
  accepts exactly `AgentEvent | CanvasOpEvent | PinOpEvent` (see
  `packages/adapters/realtime/src/port.ts:6`).
- **`userId` is the *human* user who triggered the turn**, surfaced via
  `appendCanvasEvent` so audit trails stay readable even when the actor is
  `'agent'`.

### Tests

`packages/server/src/agent/applier.test.ts` — unit tests against an in-memory
`Db` and a fake `RealtimeBus` (capturing published events):

1. `addCanvasBlock` writes a `text` block with `createdBy: 'agent'`, appends
   an `add_block` canvas event, publishes a `canvas-op` event on
   `project:<id>`. Returns the created block.
2. `pinBlock` sets `isPinned = true`, appends a `pin` event, publishes a
   `pin-op` with `op: 'pin'`.
3. `unpinBlock` mirrors pin with `false` / `unpin`.
4. If the DB write throws, `publish` is *not* called (ordering invariant).

---

## Step 4 — In-memory per-project concurrency guard

**Outcome:** a second concurrent `POST /projects/:id/agent` for the same
project returns `409 AGENT_BUSY` instead of racing mutations.

File: `packages/server/src/agent/concurrency.ts` (new).

```ts
export interface AgentConcurrencyGuard {
  acquire(projectId: ProjectId): { release: () => void } | null
}

export function createAgentConcurrencyGuard(): AgentConcurrencyGuard {
  const inflight = new Set<ProjectId>()
  return {
    acquire(projectId) {
      if (inflight.has(projectId)) return null
      inflight.add(projectId)
      return { release: () => inflight.delete(projectId) }
    },
  }
}
```

Design notes:

- **One concurrent turn per project, not per user.** Two browser tabs on the
  same project would otherwise race the same canvas.
- **Process-local.** Fine for self-hosted v1. A second server instance behind
  a load balancer can produce concurrent turns; if/when we scale horizontally,
  swap this for a Postgres advisory lock keyed on `hashtext(project_id)`.
- **No queue / wait.** Explicit 409 > hidden wait. Frontend can surface a
  "another turn is running" toast.
- **Construction site.** Built once in `main.ts` and threaded through
  `AppDeps.agentGuard` so tests can inject a fake (or a pass-through for
  tests that don't care about concurrency).

### Tests

`packages/server/src/agent/concurrency.test.ts` — two cases: acquire+release
allows a follow-up acquire; acquire twice without release returns `null`.

---

## Step 5 — SSE wire format

**Outcome:** a helper that converts an `AsyncIterable<AgentEvent>` into a
`text/event-stream` response body compatible with Vercel AI SDK UI's
`useChat`.

File: `packages/server/src/agent/sse.ts` (new).

Format:

```
event: <kind>
data: <JSON-encoded AgentEvent>

```

- Two-newline terminator per event (SSE spec).
- `event: <kind>` lets clients filter via `EventSource.addEventListener(kind, …)`
  if they want — the default `onmessage` still fires and carries `data`.
- A terminal synthetic `event: done` / `data: {}` frame after the iterable
  completes so clients can stop listening deterministically. On iterator
  `throw`, emit `event: error` with `{ message }` and then `done`.
- Ping comments (`: keep-alive\n\n`) every 15s while the stream is open —
  keeps connection alive through proxies with idle timeouts. Clear the
  interval on close.

Implementation shape:

```ts
export function streamResponseToSse(opts: {
  events: AsyncIterable<AgentEvent>
  onEvent?: (e: AgentEvent) => void        // hook for persistence
  signal: AbortSignal                       // from c.req.raw.signal
  log: Logger
}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ping = setInterval(() => controller.enqueue(encoder.encode(': keep-alive\n\n')), 15_000)
      try {
        for await (const event of opts.events) {
          if (opts.signal.aborted) break
          opts.onEvent?.(event)
          controller.enqueue(encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`))
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
      } catch (err) {
        opts.log.error({ err: err instanceof Error ? err.message : String(err) }, 'agent stream error')
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : 'stream error' })}\n\n`,
        ))
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
      } finally {
        clearInterval(ping)
        controller.close()
      }
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
```

Design notes:

- **Persistence hook fires as events are emitted**, not after. That lets the
  route accumulate assistant text from `message` events and persist once on
  stream completion (step 6). A failure mid-stream yields a partial assistant
  message — still valuable to persist so the user can see what was produced
  before the break. Policy: persist whatever assistant text we've accumulated
  in a `finally` on the route, regardless of outcome.
- **No JSON schema validation on the wire.** `streamResponse` already emits
  typed events; re-parsing would be paranoia.

### Tests

`packages/server/src/agent/sse.test.ts` — feed a fixed array as an async
iterable, assert the exact byte stream: correct `event:` lines, JSON `data:`,
trailing `done`. One case for the error arm.

---

## Step 6 — The route: `POST /projects/:id/agent`

**Outcome:** the end-to-end happy path.

File: `packages/server/src/routes/agent.ts` (new).

Signature:

```ts
export interface AgentRouteDeps {
  db: Db
  env: Env
  llm: LLMProvider
  realtime: RealtimeBus
  agentGuard: AgentConcurrencyGuard
}

export function createAgentRouter(deps: AgentRouteDeps): Hono<AppEnv>
```

Request body (validated with zod, shared schema):

```ts
const PostAgentBody = z.object({
  // The new user turn. Id is optional — server mints if absent.
  message: z.object({
    id: z.string().min(1).optional(),
    content: z.string().min(1).max(8_000),
  }),
})
```

The schema lives in `packages/shared/src/agent/api.ts` and is also exported
from the barrel so the frontend (Phase 7) can reuse it.

Handler flow (pseudocode, with file refs):

```ts
router.post('/:id/agent', zValidator('param', ProjectParam), zValidator('json', PostAgentBody), async (c) => {
  const userId = c.var.userId
  if (!userId) throw new UnauthorizedError()
  const { id: projectId } = c.req.valid('param')
  const body = c.req.valid('json')

  // 1. Authz + load (reuse existing helpers).
  const { project, brand, workspace } = await requireProjectAccess(userId, projectId, deps.db)

  // 2. Concurrency guard.
  const slot = deps.agentGuard.acquire(projectId)
  if (!slot) throw new ConflictError('another turn is running on this project', 'AGENT_BUSY')

  try {
    // 3. Resolve LLM settings (env fallback if workspace unset).
    const resolved = await resolveLLMSettings(workspace.id, deps.env, deps.db)
    const llmSettings: LLMProviderSettings = { providerId: resolved.llmProviderId, modelId: resolved.llmModel }

    // 4. Load canvas + brand context.
    const canvas = await deps.db.getCanvasByProject(projectId)
    if (!canvas) throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND') // invariant violation — log it.
    const [blocks, shortlist, sections, history] = await Promise.all([
      deps.db.listActiveBlocks(canvas.id),
      deps.db.getShortlistView(projectId),
      deps.db.listSectionsByBrand(brand.id),
      deps.db.listAgentMessages(projectId, { limit: 40 }),
    ])
    const brandWithSections: BrandWithSections = { ...brand, sections }

    // 5. Persist user message *before* streaming starts (so reconnecting clients see it).
    const userMessage = await deps.db.appendAgentMessage({
      projectId, role: 'user', content: body.message.content, userId,
    })

    // 6. Build applier, assemble messages.
    const applier = createDbRealtimeApplier({
      db: deps.db, realtime: deps.realtime, projectId, canvasId: canvas.id, userId, log: c.var.log,
    })
    const messages: AgentMessage[] = [...history, userMessage]

    // 7. Stream.
    const events = streamResponse({
      brand: brandWithSections,
      blocks,
      shortlistBlockIds: shortlist.blockIds,
      messages,
      llmProvider: deps.llm,
      llmSettings,
      applier,
      signal: c.req.raw.signal,
    })

    // 8. Accumulate assistant text for persistence; release guard on close.
    const assistantBuffer: AgentMessage[] = []
    return streamResponseToSse({
      events,
      signal: c.req.raw.signal,
      log: c.var.log,
      onEvent: (event) => {
        if (event.kind === 'message' && event.role === 'assistant') {
          assistantBuffer.push(event)
        }
        // Also mirror user-visible events onto the realtime bus.
        // Canvas-op and pin-op already publish inside the applier.
        // Message + tool-call events publish here so sibling clients see typing.
        if (event.kind === 'message' || event.kind === 'tool-call') {
          void deps.realtime.publish(`project:${projectId}`, event)
        }
      },
    }).finally?.(() => { /* …but Response doesn't .finally. See below… */ })
  } finally {
    // Guard release needs to happen when the stream ends, not when the handler returns.
    // Solution: pass `slot.release` as a second onComplete hook into streamResponseToSse.
    slot.release()
  }
})
```

### Two subtleties that need a concrete fix

1. **`finally { slot.release() }` fires when the handler *returns the
   Response*, not when the stream ends.** Hono hands the Response to
   `@hono/node-server`, which keeps writing; our guard would release
   immediately and allow a second overlapping turn. Fix: extend
   `streamResponseToSse` with an `onClose` callback invoked in the
   `ReadableStream`'s `finally` block. The route passes `slot.release` and the
   assistant-persist function as `onClose`. Draft:
   ```ts
   streamResponseToSse({ events, signal, log, onEvent, onClose: async () => {
     slot.release()
     const content = assistantBuffer.map((m) => m.content).join('')
     if (content) {
       await deps.db.appendAgentMessage({ projectId, role: 'assistant', content })
     }
   }})
   ```
   Update step 5's signature accordingly. The route no longer needs its own
   `try/finally` around the slot.

2. **`c.req.raw.signal` cancellation semantics.** Node's http server aborts
   the request signal on client disconnect. `streamText` accepts `abortSignal`
   and will stop token generation. In the SSE helper, `signal.aborted` breaks
   the for-await loop so we stop enqueueing, and the reader-side close fires
   the `finally` — releasing the guard and persisting whatever we have.

### Wire the route in `app.ts`

- `packages/server/src/app.ts`:
  - `AppDeps` gains `agentGuard: AgentConcurrencyGuard`.
  - Mount `createAgentRouter({...})` under `/projects` (alongside
    `createProjectsRouter`). Path becomes `/projects/:id/agent`.
- `packages/server/src/main.ts`:
  - `const agentGuard = createAgentConcurrencyGuard()` once at boot.
  - Thread through `createApp({...})`.
- `packages/server/src/test-helpers.ts`:
  - `createTestApp` builds an `agentGuard` by default; allows override for
    concurrency tests.

### Error taxonomy additions

- `ConflictError(message, code)` → HTTP 409 in `middleware/error.ts`. Already
  has `NotFoundError`, `ForbiddenError`, `UnauthorizedError`; `ConflictError`
  is a one-liner in `errors.ts` + a branch in the error middleware.

---

## Step 7 — Tests for the route

File: `packages/server/src/routes/agent.test.ts`.

**Fake LLM provider** — reuse the hand-rolled `LanguageModelV1` fake from
`packages/agent/src/stream.test.ts` (extract to a shared test helper in
`packages/agent/src/test-support.ts` and re-export, or copy — the fake is
small enough that duplication is OK for v1). Scenarios the fake should
support:

- Emit N `text-delta` parts then `finish` → asserts message persistence.
- Emit `tool-call` (`add_canvas_block`) with args → then `tool-result` →
  `finish`. Asserts applier is called, canvas mutated, realtime event
  published, assistant message persisted.
- Emit `error` part → asserts SSE `error` frame, guard released, whatever
  assistant text has accumulated is persisted (can be empty).

**Test cases:**

1. **Unauthorized** (no `userId` in context) → 401.
2. **Project not found / no access** → 404 / 403 via `requireProjectAccess`.
3. **Happy path, no tool use** — pure text stream. Assert:
   - response status 200, content-type `text/event-stream`.
   - body contains `event: message` frames with the expected content.
   - body ends with `event: done`.
   - `agent_messages` has one user row and one assistant row for the project.
4. **Happy path with `add_canvas_block`** — assert:
   - A `text` block was created with `createdBy: 'agent'`.
   - A `canvas_events` row was appended with `op: 'add_block'`, `actor: 'agent'`.
   - The realtime bus saw a `canvas-op` publish on `project:<id>`.
   - Body contains a `canvas-op` frame.
5. **Concurrency guard** — fire two requests with an overlapping fake that
   pauses on the first `text-delta`. Second request returns `409 AGENT_BUSY`.
   After first completes, a third request succeeds.
6. **Client disconnect mid-stream** — abort the request signal after the
   first delta. Assert guard is released and whatever was streamed was
   persisted as the assistant message.
7. **Stream error** — fake emits an `error` part. Response completes with an
   `event: error` frame; guard is released; user message was persisted; no
   assistant row written (or empty content row — pick one, doc it).
8. **LLM resolve uses env fallback** — workspace has no settings row; the
   request still succeeds using `LLM_PROVIDER` / `LLM_MODEL` from `testEnv`.

All tests use in-memory fakes for `Db`, `RealtimeBus`, and the LLM provider.
No network, no Postgres.

---

## Step 8 — Shared API schema + barrel exports

- `packages/shared/src/agent/api.ts` (new) — `PostAgentBodySchema`,
  `PostAgentBody` type. Frontend will import this in Phase 7.
- `packages/shared/src/index.ts` — re-export.
- Update `docs/architecture.md` if any port/adapter shape changed (should
  be none — this phase adds routes and wiring, not new ports).

---

## Step 9 — Smoke script

File: `packages/server/scripts/smoke-agent.ts` (new).

Drives the live route against a locally booted server:

1. Boot the server against dev Postgres + a real `LLMProvider` from env
   (OpenRouter preferred — see `@brandfactory/agent/scripts/smoke.ts` for the
   pattern).
2. Seed a workspace / brand / project via existing helpers (or reuse the
   scaffolding in `packages/db/scripts/smoke.ts`).
3. `curl`-equivalent `POST /projects/:id/agent` and parse the SSE stream.
4. `GET /projects/:id` to confirm canvas mutation persisted.
5. Exit 0 on success, non-zero on any step failure.

Gated on `OPENROUTER_API_KEY` + `DATABASE_URL`. Listed in changelog as
"run locally" — not part of `pnpm test`.

---

## Verification checklist

Before declaring Phase 6 done:

```
pnpm install        ✔  lockfile stable (no new deps required — ai + zod already shared)
pnpm typecheck      ✔  all 9 workspaces
pnpm lint           ✔  clean
pnpm format:check   ✔  clean
pnpm test           ✔  all existing + ~15 new cases (applier 4, concurrency 2, sse 2, route 7–8)
pnpm --filter @brandfactory/server smoke-agent   ☐  run locally against dev Postgres + OPENROUTER_API_KEY
```

Manual `curl` sanity check (documented in the changelog entry, not gated in CI):

```
curl -N -H 'Authorization: Bearer <dev-token>' \
     -H 'content-type: application/json' \
     -d '{"message":{"content":"Give me three tagline options."}}' \
     http://localhost:3000/projects/<project-id>/agent
```

Expected: streamed `event: message` frames, optionally one `event: canvas-op`
if the model tool-uses, trailing `event: done`. `GET /projects/<id>` reflects
any blocks the model added.

---

## Suggested commit order

One commit per step, in this order, each green on `pnpm test && pnpm typecheck
&& pnpm lint`:

1. `db: agent_messages table + queries + mapper` (step 1 + 2)
2. `server: createDbRealtimeApplier` (step 3)
3. `server: agent concurrency guard` (step 4)
4. `server: SSE response helper` (step 5)
5. `shared: PostAgentBody schema` (step 8 — land before route so route imports are clean)
6. `server: POST /projects/:id/agent route + wiring` (step 6 + 7)
7. `server: smoke-agent script` (step 9)
8. `docs: changelog 0.7.0` (Phase 6 entry, mirroring the 0.5.0 / 0.6.0 prose style)

Each commit is independently reviewable and revertible. Step 6 is the big
one; steps 1–5 can land in any order as long as they're in before step 6.

---

## Items flagged for the post-Phase-6 hardening pass

(Same cadence as 0.4.1 / 0.5.1 / 0.6.1 — surfaced now so they don't get
forgotten, not worked on during Phase 6.)

- **Advisory-lock concurrency guard** for horizontally-scaled deploys.
- **Assistant-message atomic-with-canvas-ops persistence** — currently the
  applier writes canvas blocks in their own transactions and the assistant
  message is written on stream close; a crash between them leaves
  inconsistent state. Candidate fix: buffer canvas ops, commit all in one tx
  with the assistant message. Blocked on streaming-vs-atomic tradeoff
  discussion.
- **Token redaction in request logs** — the PostAgentBody content can contain
  secrets pasted by the user. Part of the Phase-8 pino swap per 0.6.0's
  deferral list.
- **Per-user rate limit** (distinct from per-project concurrency). Nice-to-have
  once we have >1 seat per workspace.
- **Live-DB vitest for `agent_messages` queries**, same pattern as the
  deferred integration suite in 0.6.1.
