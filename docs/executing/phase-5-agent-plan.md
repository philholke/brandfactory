# Phase 5 — `@brandfactory/agent` Implementation Plan

Companion to [scaffolding-plan.md](./scaffolding-plan.md) §Phase 5. Where
the scaffolding plan sketches the shape, this plan lists the concrete
steps to land Phase 5 in order, with file paths, exports, and
acceptance criteria so we can execute methodically.

## Goal

Stand up `@brandfactory/agent` as the **server-only** orchestration
layer that turns `(brand, canvas, userMessage) → streamed
AgentEvent[]`. It composes the system prompt, assembles canvas
context, defines canvas-manipulation tools, and streams Vercel AI
SDK output through a typed iterable. It never talks to the DB, the
realtime bus, or an HTTP surface directly — those are Phase 6's job.

Phase 5 ships the package + a scratch script that drives it against
a real `LLMProvider`; the HTTP route that consumes it lands in
Phase 6.

## What's already in place (seams we plug into)

- **`@brandfactory/shared`**
  - `AgentEvent` union: `message | tool-call | canvas-op | pin-op`
    with zod schemas at `packages/shared/src/agent/events.ts`.
  - `Brand`, `BrandWithSections`, `BrandGuidelineSection`,
    `Canvas`, `CanvasBlock` (text | image | file), `ShortlistView`.
  - `LLMProviderId`, `LLM_PROVIDER_IDS`,
    `LLMProviderIdSchema` (single source since 0.5.1).
- **`@brandfactory/adapter-llm`**
  - `LLMProvider.getModel(settings) → LanguageModel` (AI SDK core
    `LanguageModel`). Already cached per providerId, already
    tested.
  - `LLMProviderSettings = { providerId, modelId }`.
- **`packages/agent`** — empty scaffold (`src/index.ts` exports
  `{}`, `package.json` has `typecheck` + `lint` only, tsconfig
  extends `../../tsconfig.base.json`).
- **Vitest** — already wired in projects mode across the repo.

## Non-goals for Phase 5

Phase 5 builds the *library*. Do not:

- Create or modify any route in `@brandfactory/server`. That's Phase 6.
- Persist anything. Tool handlers call an injected
  `CanvasOpApplier`; the agent package has no `@brandfactory/db`
  dep.
- Publish on `RealtimeBus`. Also Phase 6.
- Resolve workspace settings. The caller passes
  `{ providerId, modelId }` and the agent asks
  `LLMProvider.getModel` — selection logic lives in the server.
- Persist assistant messages. The server will do this in Phase 6
  when it owns the stream.
- Add a rate limiter or concurrency guard. Phase 6.

## Dependencies to add

In `packages/agent/package.json`:

- `ai` (Vercel AI SDK core — same version range as
  `@brandfactory/adapter-llm`; keep them aligned).
- `zod` (peer of shared's schemas — used for tool arg schemas).
- `@brandfactory/shared: workspace:*`
- `@brandfactory/adapter-llm: workspace:*` (type-only consumption
  of `LLMProvider`; agent never constructs one).

No DB, no server, no realtime, no storage deps. If you reach for
one, stop and route through an injected applier instead.

## Task order

### 5.1 Package wiring

- [ ] Add the deps listed above; run `pnpm install` and commit
      the lockfile change.
- [ ] `packages/agent/vitest.config.ts` — mirror the other
      packages' pattern (projects mode entry already picks up
      `*.test.ts`; add the per-package config only if needed to
      scope `include`).
- [ ] `packages/agent/package.json` — add `test` script:
      `"test": "vitest run"`.
- [ ] Barrel `packages/agent/src/index.ts` is rewritten in 5.6;
      stays `export {}` until then.

**Acceptance:** `pnpm install && pnpm --filter @brandfactory/agent
typecheck && pnpm --filter @brandfactory/agent lint` all green.

### 5.2 `buildSystemPrompt(brand)`

- [ ] New file
      `packages/agent/src/prompts/system-prompt.ts`.
- [ ] Signature:
      `buildSystemPrompt(brand: BrandWithSections): string`.
      (`BrandWithSections` is the right input — the agent needs
      the sections, not just the brand row.)
- [ ] Content structure (exact text tunable later, shape
      fixed now so Phase 6 wiring doesn't shift):
  1. Role preamble — "You are the creative partner for brand
     `<name>`. Every response must be consistent with the brand's
     guidelines below."
  2. Brand header — `name`, `description` (if present).
  3. Guideline sections rendered in `priority` order.
     `ProseMirrorDoc` bodies are serialized by a dedicated helper
     (5.2.1) — do not `JSON.stringify` the raw doc into the
     prompt.
  4. Canvas-awareness contract — short paragraph explaining that
     a canvas context block will follow, that tool calls are the
     way to mutate the canvas, and that pinned blocks are the
     "shortlist the user liked."
- [ ] 5.2.1 `packages/agent/src/prompts/prose-mirror-to-text.ts`
      — `proseMirrorDocToPlainText(doc: ProseMirrorDoc): string`.
      Walk the JSON: concatenate `text` nodes, insert `\n\n` at
      block boundaries (paragraph / heading / list item).
      Deliberately lossy — this is context for the LLM, not a
      faithful rendering.
- [ ] Test: `system-prompt.test.ts` asserts the prompt contains
      brand name, every section label in priority order, and the
      plain-text body of each section.

**Acceptance:** snapshot-style test passes;
`proseMirrorDocToPlainText` covers paragraph + heading + bullet
list + nested list cases.

### 5.3 `buildCanvasContext(blocks, shortlist)`

- [ ] New file
      `packages/agent/src/prompts/canvas-context.ts`.
- [ ] Signature:
      ```
      buildCanvasContext(input: {
        blocks: CanvasBlock[]        // active blocks, asc position
        shortlistBlockIds: CanvasBlockId[]
        recentOps?: CanvasOp[]       // optional; last N ops, Phase 6 will populate
      }): string
      ```
- [ ] Output layout: one `CANVAS STATE` section with three
      sub-blocks:
  1. **PINNED** — list of pinned blocks (id, kind, one-line
     summary). Summary rules:
     - `text`: first ~200 chars of `proseMirrorDocToPlainText`.
     - `image`: `[image: alt || "untitled"] (w×h)` when
       available.
     - `file`: `[file: filename] (mime)`.
  2. **UNPINNED** — same shape, capped at N (start with 20;
     export the constant so it's easy to tune). When truncated,
     append `… and K more` so the model knows more exists.
  3. **RECENT OPS** — only rendered if `recentOps` is non-empty.
     One line per op: `add-block <id>`, `update-block <id>`,
     `remove-block <id>`.
- [ ] Test: covers pinned+unpinned split, truncation of
      unpinned, recent-ops rendering, empty canvas graceful
      output.

**Acceptance:** function is pure (no side effects, no I/O), deterministic on inputs.

### 5.4 Tool definitions + `CanvasOpApplier`

Three tools ship in 5.4. Anything richer (move, update, soft-delete,
reorder) is a Phase 6+ add.

- [ ] New file `packages/agent/src/tools/applier.ts` —
      `CanvasOpApplier` interface. Three methods, all returning
      the applied data so the agent can echo the resulting id
      back to the model:
      ```
      export interface CanvasOpApplier {
        addCanvasBlock(input: {
          kind: 'text'
          body: ProseMirrorDoc
          position: number
        }): Promise<CanvasBlock>
        pinBlock(blockId: CanvasBlockId): Promise<CanvasBlock>
        unpinBlock(blockId: CanvasBlockId): Promise<CanvasBlock>
      }
      ```
      Text-only `addCanvasBlock` for v1 — image/file creation
      goes through the blob upload flow, not the agent. Leave a
      `// image/file tool variants deferred to Phase 6+` comment.
- [ ] New file `packages/agent/src/tools/definitions.ts` —
      builds AI SDK `tool({...})` objects. Each tool:
      - `description` the model reads.
      - `parameters`: zod schema. Reuse `ProseMirrorDocSchema`
        and `CanvasBlockIdSchema` from shared rather than
        redefining.
      - `execute`: calls the injected applier, then returns a
        compact JSON result (e.g., `{ blockId, isPinned }`) so
        the model can reason about what happened without us
        leaking the full row into the conversation.
- [ ] Tool set factory
      `buildCanvasTools(applier: CanvasOpApplier): ToolSet`.
      `ToolSet` is AI SDK's `Record<string, Tool>` shape; re-
      export the type from `ai`.
- [ ] Test: `tools.test.ts` — instantiates the tool set with a
      fake applier, invokes each `execute` with a validated
      payload, asserts the applier was called with the expected
      args and that the returned JSON matches the contract.

**Acceptance:** tool schemas validate good/bad input; applier is the
only side-effect seam.

### 5.5 `streamResponse` — the entry point

- [ ] New file `packages/agent/src/stream.ts`.
- [ ] Signature:
      ```
      export interface StreamResponseInput {
        brand: BrandWithSections
        blocks: CanvasBlock[]
        shortlistBlockIds: CanvasBlockId[]
        recentOps?: CanvasOp[]
        messages: AgentMessage[]          // full chat history
        llmProvider: LLMProvider
        llmSettings: LLMProviderSettings  // providerId + modelId
        applier: CanvasOpApplier
        signal?: AbortSignal              // forwarded to streamText
      }

      export function streamResponse(
        input: StreamResponseInput,
      ): AsyncIterable<AgentEvent>
      ```
- [ ] Internals:
  1. Build system prompt (5.2) and canvas context (5.3).
     Concatenate: `system + '\n\n' + canvasContext`. Pass as
     `system` to `streamText`. Canvas context is prepended to
     system instead of injected as a user message so the model
     doesn't treat it as something to respond to.
  2. Translate `messages: AgentMessage[]` into AI SDK
     `ModelMessage[]` (role `user` | `assistant`, `content`
     string).
  3. Call `streamText({ model: llmProvider.getModel(llmSettings),
     system, messages, tools: buildCanvasTools(applier), signal })`.
  4. Return an async generator that yields `AgentEvent`s by
     consuming `result.fullStream`:
     - `text-delta` chunks → accumulate into a
       `message` event. Yield one `AgentMessage` per assistant
       turn (at the first delta, allocate an id; flush on
       finish/tool-call boundary).
     - `tool-call` chunks → yield `AgentToolCall`.
     - Tool-result side effects (via the applier's returned
       `CanvasBlock`) → yield `CanvasOpEvent` and/or
       `PinOpEvent` synthesized from the applier return value.
       Important: the applier already did the work; the event
       is just the notification for downstream (Phase 6 will
       forward to realtime).
     - Errors / abort → surface as a thrown error from the
       generator. Do not swallow.
- [ ] Add a `isCanvasOpEvent` / `isPinOpEvent` narrowing helper
      if it helps server-side fan-out; keep it in-file until a
      second consumer exists.

**Acceptance:** smoke script (5.7) shows message deltas → tool
calls → synthesized canvas-op events → final assistant message,
in that order.

### 5.6 Package barrel

- [ ] `packages/agent/src/index.ts` re-exports:
      - `streamResponse`, `StreamResponseInput`
      - `buildSystemPrompt`, `buildCanvasContext`
      - `CanvasOpApplier`
      - `buildCanvasTools` (Phase 6 may want to inspect the tool
        set separately, e.g., for per-tool authz)
- [ ] Everything else (prompt helpers, constants) stays
      internal. No `**/*` globs in `exports`.

### 5.7 Smoke script

- [ ] `packages/agent/scripts/smoke.ts`.
- [ ] Constructs:
  - A fake `BrandWithSections` with two sections.
  - A fake `blocks` array (one text block, one pinned text
    block).
  - An in-memory `CanvasOpApplier` that stores ops in an array
    and returns plausible `CanvasBlock` rows.
  - An `LLMProvider` built via
    `createLLMProvider({ openrouter: { apiKey: process.env.OPENROUTER_API_KEY! }})`.
  - A one-message `messages` array: "suggest three taglines and
    pin the one you like best."
- [ ] Iterates `streamResponse(...)` and prints each event.
- [ ] Add `packages/agent/package.json` script:
      `"smoke": "tsx scripts/smoke.ts"` (dev-dep `tsx`).
- [ ] Gate on `OPENROUTER_API_KEY`; exit with a clear message
      if absent rather than blowing up mid-stream.

**Acceptance:** `OPENROUTER_API_KEY=... pnpm --filter
@brandfactory/agent smoke` prints interleaved `message` and
`tool-call` events, the fake applier's array has at least one
`add-block` entry, and the script exits 0.

## Tests to ship (unit, no network)

Aim for ~15–20 new vitest cases. All deterministic; no real
`LLMProvider`.

- `prose-mirror-to-text.test.ts` — 4+ cases covering paragraph,
  heading, bullet/ordered list, nested list.
- `system-prompt.test.ts` — 2+ cases (happy path + brand with
  zero sections).
- `canvas-context.test.ts` — 4+ cases (empty, pinned only,
  truncation, recent ops).
- `tools.test.ts` — one case per tool: validates args, calls
  applier, returns compact JSON.
- `stream.test.ts` — 3+ cases driven by a **fake
  `LanguageModel`** that yields a scripted sequence of AI SDK
  stream parts:
  1. Plain message (no tool calls) → single `message` event
     produced.
  2. Tool call → applier invoked → synthesized
     `canvas-op` / `pin-op` events in the output iterable in the
     right order.
  3. Abort signal propagates and the generator throws.

The fake `LanguageModel` is constructed by hand (don't pull in
the AI SDK test helpers if they're not already present); it
implements only the methods `streamText` actually calls against
it.

## Verification checklist (run before calling Phase 5 done)

- `pnpm install` — clean.
- `pnpm typecheck` — 9/9 workspaces pass (agent now carries real
  types).
- `pnpm lint` — clean.
- `pnpm test` — existing 83 cases still pass; new agent cases
  green.
- `pnpm --filter @brandfactory/agent smoke` with a valid
  `OPENROUTER_API_KEY` — streams events, applier got at least
  one op.

## Follow-ups & open questions

Capture these, don't solve them in Phase 5:

- **Message-id allocation.** Phase 5 generates assistant message
  ids locally (uuid v4). Phase 6 will likely want them
  round-tripped through the DB for the assistant-message persist
  step — revisit when building the route.
- **Canvas-context token budget.** The N=20 unpinned cap is a
  guess. Once we see real prompts, swap for a character-budget
  truncator.
- **`update-block` / `remove-block` tools.** Deliberately out.
  Re-open once we have a feel for what the model actually tries
  to do.
- **Image / file creation tools.** Needs a story for how the
  agent obtains a `blobKey` — probably a separate "ask the user
  to upload" pattern rather than the agent minting bytes.
- **Multi-turn tool loops.** `streamText` already handles
  multi-step tool calls; verify behaviour in the smoke script
  before adding any orchestration of our own.
- **Eval hooks.** The architecture doc flags this as a future
  agent responsibility. No hook points in Phase 5 — they land
  when we have a real eval harness to plug in.
