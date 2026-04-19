# Phase 4 Cleanup — Post-review tightening

**Status:** complete
**Scope:** the six issues surfaced by the post-Phase-4 code review (see [phase4.md](./phase4.md) for the original phase wrap). No new feature surface; all changes are correctness, type-system, and boundary tightening before Phase 5 starts the `@brandfactory/agent` package.
**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` — all green across 9 workspaces. Test count holds at 83 (the existing route tests were re-pointed at the new helpers; behaviour parity preserved).

---

## What landed

### 1. Atomic project + canvas creation

Phase 4 created a project then created its 1:1 canvas as two separate writes. If the canvas insert failed, the project was orphaned and the route returned a 500 — Phase 5's agent endpoint would have started programmatically creating projects against this hazard.

- **`packages/db/src/queries/projects.ts`** — added `createProjectWithCanvas(input): Promise<{ project; canvas }>` that runs both inserts inside `db.transaction`. Mirrors the `CreateProjectInput` discriminator.
- **`packages/server/src/db.ts`** — `Db` facade now exposes `createProjectWithCanvas` and no longer carries the standalone `createProject` / `createCanvas` (the route was the only consumer; the `db` package still exports the lower-level helpers for the smoke script).
- **`packages/server/src/routes/projects.ts`** — POST `/brands/:brandId/projects` calls the new helper; it destructures `{ project }` to keep the response body unchanged.
- **`packages/server/src/test-helpers.ts`** — fake `createProjectWithCanvas` writes both maps in one shot, matching the real helper's contract.
- **`packages/server/src/{authz,ws}.test.ts`** — seed helpers updated to use the new helper.

The existing `projects.test.ts` assertions on `state.canvases.values()` and the `GET /projects/:id` canvas hydration are unchanged, so the regression net stayed.

### 2. Single source of truth for `LLMProviderId`

Three packages were re-declaring the four-provider tuple in lockstep. The server's env loader caught server↔adapter drift via `as const satisfies readonly LLMProviderId[]`, but a divergent shared schema would have shipped silently. Phase 5's agent runs off `resolveLLMSettings`, which means a drifted shared schema could ship a wrong `llmProviderId` value through the wire DTO.

- **New: `packages/shared/src/llm/provider-ids.ts`** — owns `LLM_PROVIDER_IDS` (the const tuple), `LLMProviderIdSchema = z.enum(LLM_PROVIDER_IDS)`, and `type LLMProviderId = z.infer<...>`. Single source.
- **`packages/shared/src/index.ts`** — barrel exports the new module.
- **`packages/shared/src/workspace/settings.ts`** — drops its local `z.enum([...])` declaration; imports `LLMProviderIdSchema` from `../llm/provider-ids`. The `WorkspaceSettings`, `UpdateWorkspaceSettingsInput`, and `ResolvedWorkspaceSettings` schemas keep their existing names and shapes.
- **`packages/adapters/llm/src/port.ts`** — drops its local string-literal union; re-exports `LLMProviderId` from `@brandfactory/shared` so existing call sites (`import { LLMProviderId } from '@brandfactory/adapter-llm'`) keep working.
- **`packages/adapters/llm/package.json`** — adds `@brandfactory/shared: workspace:*` to deps. No cycle (`shared` has no adapter deps).
- **`packages/server/src/env.ts`** — imports `LLM_PROVIDER_IDS` directly from shared. The local tuple + `satisfies` block goes away; the `superRefine` `default: never` exhaustiveness guard stays.
- **`packages/server/src/settings.ts`** — `env.LLM_PROVIDER` is now natively typed `LLMProviderId`, so `as LLMProviderId` cast in `resolveLLMSettings` is removed along with the "kept aligned by hand" comment.

After this change there is exactly one place to widen the provider list; every consumer fails compile or boot if anyone tries to drift.

### 3. Trust-boundary validation on `workspace_settings.llm_provider_id`

The column is intentionally `text` (not `pgEnum`) so widening the provider list doesn't need a schema migration — but that meant any internal caller using an `as`-cast or hand-rolled SQL could write garbage that would silently bypass the route's zod gate. Adding a CHECK constraint would have undone the widen-without-migration design choice.

- **`packages/db/src/queries/workspace-settings.ts`** — both `rowToWorkspaceSettings` (read path) and `upsertWorkspaceSettings` (write path) now run the value through `LLMProviderIdSchema.parse`. The helper is now the trust boundary: nothing past it sees a provider id outside `LLM_PROVIDER_IDS`. If the shipped enum widens in shared but production hasn't deployed the new server yet, a row written by the new code surfaces loudly in the old code instead of corrupting downstream typing.
- **`packages/db/src/schema/workspace_settings.ts`** — comment updated to call out the helper as the trust boundary, with a pointer to the `LLMProviderIdSchema` parse.

Migration intentionally not regenerated; column type is unchanged.

### 4. Discriminated-union return for `buildAdapters().realtime`

`main.ts` previously did `adapters.realtime as NativeWsRealtimeBus` to reach `bindToNodeWebSocketServer`. That cast defeated the type system — adding a future redis or supabase realtime impl would have failed at runtime, not compile time.

- **`packages/server/src/adapters.ts`** — new `RealtimeAdapter = { provider: 'native-ws'; bus: NativeWsRealtimeBus }` discriminated union. `Adapters.realtime: RealtimeAdapter`. `buildAdapters` returns `{ provider: 'native-ws', bus: createNativeWsRealtimeBus() }`.
- **`packages/server/src/main.ts`** — the `as` cast goes away. The Hono app receives `adapters.realtime.bus` directly (it only needs the `RealtimeBus` pub/sub surface). The WS upgrade is mounted via a `switch` on `adapters.realtime.provider` with a `const _exhaustive: never = adapters.realtime.provider` default branch — adding a second variant fails compile at the `default:` case.
- **`packages/server/src/adapters.test.ts`** — assertion updated to check `realtime.provider === 'native-ws'` and that `realtime.bus` carries the expected functions.

`AppDeps.realtime` keeps its `RealtimeBus` type (the app doesn't need the binder), so route modules and `createTestApp` are unchanged.

### 5. `instanceof BlobNotFoundError` instead of `name`-sniff

`routes/blobs.ts` was detecting the not-found branch via `(err as Error).name === 'BlobNotFoundError'` to keep the route module decoupled from the storage impl class. The class is already exported from the `BlobStore` port, so the sniff bought us nothing and was brittle if the impl ever renamed it.

- **`packages/server/src/routes/blobs.ts`** — imports `BlobNotFoundError` from `@brandfactory/adapter-storage`; uses `err instanceof BlobNotFoundError`. Comment trimmed.
- **`packages/server/src/routes/blobs.test.ts`** — fake store now throws `new BlobNotFoundError(key)` instead of constructing a generic `Error` with a hand-set `name`.

### 6. Atomic upsert + reorder for `PATCH /brands/:id/guidelines`

The route was looping `upsertSection` (one statement per item, no shared tx) then calling `reorderSections` (which is itself in a tx). A failure mid-loop left the brand half-updated — some rows at the new label/priority, some at the old.

- **`packages/db/src/queries/brands.ts`** — new `updateBrandGuidelines(brandId, sections): Promise<BrandGuidelineSection[]>`. Single `db.transaction`: each input either updates an existing row by id+brand or inserts a new one; the final select returns the sorted list, same shape as `listSectionsByBrand`. `upsertSection` and `reorderSections` are kept on the package surface for now — the smoke script still uses `upsertSection`.
- **`packages/server/src/db.ts`** — `Db` facade exposes `updateBrandGuidelines` instead of `upsertSection` + `reorderSections`. The route was the only server consumer of those two helpers.
- **`packages/server/src/routes/brands.ts`** — PATCH calls `updateBrandGuidelines` with a flat map; the previous "collect ids, then reorder" two-step is gone.
- **`packages/server/src/test-helpers.ts`** — fake `updateBrandGuidelines` mirrors the real helper's "update by id, else insert" branch and returns the sorted section list.

The existing PATCH test (upsert + label edit + priority swap) is unchanged and still asserts the ordering after both calls.

---

## Verification

```
pnpm install       ✔
pnpm typecheck     ✔  9/9 workspaces pass
pnpm lint          ✔  0 problems
pnpm format:check  ✔  all files clean
pnpm test          ✔  19 files, 83 tests pass
```

No change in test count vs. Phase 4 wrap (83) — the route-level coverage was already exercising every changed code path. Smoke script still references `createProject` / `upsertSection` / `createCanvas` from the lower-level `@brandfactory/db` package surface; running it against a live Postgres requires no migration regeneration (no schema change in this pass).

---

## Items deliberately deferred

These were called out in the same review but are not in this cleanup pass — each has a natural home in a later phase.

- **WS `?token=` query fallback exposure to upstream proxy logs.** Mitigation lands with Phase 7 CORS / cookie-based ticket flow.
- **Logger redaction for tokens/secrets.** Phase 8 swap to pino is the right time.
- **Blobs PUT content-type / max-body validation.** A signed-URL writer can already upload arbitrary bytes; tightening the allowlist is a Phase 8 polish (content-type persistence is already on that list).
- **Live WS upgrade end-to-end test.** `authorizeChannel` is unit-tested; a real-socket round-trip needs the live boot smoke (Postgres + ws server) and is captured under the Phase 4 follow-ups list.
- **404 vs 403 ordering on `GET /brands/:id` and friends.** Current behaviour leaks aggregate existence to non-owners. Consistent across routes and matches the WS `authorizeChannel` walk; product call to revisit.

---

## Files changed

```
packages/shared/src/llm/provider-ids.ts             (new)
packages/shared/src/workspace/settings.ts
packages/shared/src/index.ts
packages/adapters/llm/src/port.ts
packages/adapters/llm/package.json
packages/db/src/queries/projects.ts
packages/db/src/queries/brands.ts
packages/db/src/queries/workspace-settings.ts
packages/db/src/schema/workspace_settings.ts
packages/server/src/adapters.ts
packages/server/src/adapters.test.ts
packages/server/src/authz.test.ts
packages/server/src/db.ts
packages/server/src/env.ts
packages/server/src/main.ts
packages/server/src/routes/blobs.ts
packages/server/src/routes/blobs.test.ts
packages/server/src/routes/brands.ts
packages/server/src/routes/projects.ts
packages/server/src/settings.ts
packages/server/src/test-helpers.ts
packages/server/src/ws.test.ts
pnpm-lock.yaml
```
