# Changelog

Latest releases at the top. Each version has a one-line entry in the index
below, with full detail further down.

## Index

- **0.2.0** — 2026-04-18 — Phase 1: `@brandfactory/shared` lands as the single source of truth for domain types and zod schemas, consumed by both `server` and `web`.
- **0.1.0** — 2026-04-18 — Project bootstrap: vision, architecture blueprint, scaffolding plan, and Phase 0 repo foundation.

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
