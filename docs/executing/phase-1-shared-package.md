# Phase 1 — Shared Package: Implementation Plan

Goal: land `packages/shared` as the single source of truth for domain types
and zod schemas consumed by both frontend and backend. This file expands
Phase 1 of [scaffolding-plan.md](./scaffolding-plan.md) into concrete,
methodical steps.

## Design decisions (locked)

These resolve the flexibility questions raised before implementation:

1. **Brand guidelines are fully dynamic.** No hardcoded category enum
   (`voice`, `visual`, …) in source. Each brand owns an ordered list of
   user-defined sections.
2. **Normalized sections, not a JSONB blob.** Sections live in their own
   table (Phase 2) so row-level edits don't collide and reordering is a
   single-row update. `packages/shared` models the envelope.
3. **Suggested categories are seed data.** A plain JSON list of
   `{label, description, exampleBody}` ships alongside the schemas for
   the frontend to render a "pick a starter section" UI. Data, not types.
4. **Section body = TipTap/ProseMirror JSON.** Rich content from day one,
   stored as `jsonb`. At the shared-schema layer we type it as a generic
   JSON document — ProseMirror validity is enforced by the editor.
5. **Concurrency v1 = section-level LWW.** Consistent with canvas ops.
   Yjs + collab is a future upgrade path; schema leaves room for a
   `body_yjs` companion column without reshaping the API.

## Module layout

```
packages/shared/src/
├── json.ts                       # JsonValue + ProseMirrorDoc alias
├── ids.ts                        # BrandId, SectionId, etc. (branded strings)
├── brand/
│   ├── brand.ts                  # Brand, BrandSummary
│   ├── guideline-section.ts      # BrandGuidelineSection + suggested seed
│   └── suggested-categories.ts   # static JSON: starter section suggestions
├── workspace/
│   └── workspace.ts
├── project/
│   ├── project.ts                # discriminated union: freeform | standardized
│   └── canvas.ts                 # Canvas, CanvasBlock, Pin, ShortlistView
├── agent/
│   └── events.ts                 # AgentMessage, AgentToolCall, CanvasOp, PinOp
└── index.ts                      # barrel re-export
```

All files ESM, `import type` where possible, zero runtime deps beyond `zod`.

## Conventions

- **Schema first, types inferred.** For each domain entity: author the zod
  schema, then `export type X = z.infer<typeof XSchema>`. Single source of
  truth, no drift.
- **Branded IDs.** `type BrandId = string & { readonly __brand: 'BrandId' }`
  with a zod helper `brandedId('BrandId')`. Prevents accidentally passing a
  `ProjectId` where a `BrandId` is expected.
- **Discriminated unions** for anything with variants (project kind, canvas
  block kind, agent event kind). Use `z.discriminatedUnion('kind', [...])`.
- **Timestamps as ISO strings** at the schema boundary (`z.string().datetime()`).
  DB layer converts to/from `Date`.
- **No default values in schemas** unless the default is part of the domain
  contract. Defaults belong in the callers.
- **No business logic.** This package is contracts only.

## Tasks

Work top-to-bottom. Each group ends with a typecheck checkpoint.

### 1. Package plumbing

- [ ] Add `zod` as a dependency in `packages/shared/package.json`.
- [ ] Confirm `"type": "module"` and `exports` field are set (already done).
- [ ] Add `src/index.ts` barrel (empty for now; grows as files land).
- [ ] `pnpm --filter @brandfactory/shared typecheck` passes on empty barrel.

### 2. Primitives

- [ ] `src/json.ts` — `JsonValue` recursive type + zod schema; export
      `ProseMirrorDoc = JsonValue` alias with a comment pointing at TipTap.
- [ ] `src/ids.ts` — `brandedId<T extends string>(name: T)` helper returning
      a zod schema + inferred branded type. Export concrete ids:
      `BrandId`, `WorkspaceId`, `ProjectId`, `CanvasId`, `CanvasBlockId`,
      `PinId`, `SectionId`, `UserId`.

### 3. Workspace

- [ ] `src/workspace/workspace.ts` — `WorkspaceSchema`: `id`, `name`,
      `ownerUserId`, `createdAt`, `updatedAt`. Export `Workspace` type.

### 4. Brand + guidelines (the flexible part)

- [ ] `src/brand/guideline-section.ts`:
  - `BrandGuidelineSectionSchema`: `id (SectionId)`, `brandId (BrandId)`,
    `label (string, 1..120)`, `body (ProseMirrorDoc)`, `priority (int)`,
    `createdBy ('user' | 'agent')`, `createdAt`, `updatedAt`.
  - Export `BrandGuidelineSection` type.
  - No `key` field — sections are identified by id; label is free text.
- [ ] `src/brand/suggested-categories.ts`:
  - Plain `as const` array of `{ label, description, exampleBody }`.
  - Seed examples (voice, audience, values, visual, messaging) — these are
    *suggestions* for the UI, not schema constraints.
  - Export `SUGGESTED_SECTIONS` and a `SuggestedSection` type.
- [ ] `src/brand/brand.ts`:
  - `BrandSchema`: `id`, `workspaceId`, `name`, `description (nullable)`,
    `createdAt`, `updatedAt`. **No `guidelines` field** — sections are
    fetched separately (normalized).
  - `BrandWithSectionsSchema`: extends `BrandSchema` with
    `sections: BrandGuidelineSection[]`, for endpoints that return the
    composed view.

### 5. Project + canvas

- [ ] `src/project/project.ts`:
  - `ProjectKindSchema = z.enum(['freeform', 'standardized'])`.
  - `ProjectBaseSchema`: `id`, `brandId`, `name`, `createdAt`, `updatedAt`.
  - `FreeformProjectSchema`: `ProjectBaseSchema.extend({ kind: z.literal('freeform') })`.
  - `StandardizedProjectSchema`: `ProjectBaseSchema.extend({ kind: z.literal('standardized'), templateId: z.string() })`.
  - `ProjectSchema = z.discriminatedUnion('kind', [...])`.
- [ ] `src/project/canvas.ts`:
  - `CanvasSchema`: `id`, `projectId`, `createdAt`, `updatedAt`.
  - `CanvasBlockKindSchema = z.enum(['text', 'image', 'file', 'snippet'])`.
  - Per-kind schemas with shared base (`id`, `canvasId`, `position`,
    `createdAt`, `updatedAt`) and kind-specific payload:
    - text → `{ kind: 'text', body: ProseMirrorDoc }`
    - image → `{ kind: 'image', blobKey: string, alt?: string, width?, height? }`
    - file → `{ kind: 'file', blobKey: string, filename: string, mime: string }`
    - snippet → `{ kind: 'snippet', body: ProseMirrorDoc, sourceBlockId?: CanvasBlockId }`
  - `CanvasBlockSchema = z.discriminatedUnion('kind', [...])`.
  - `PinSchema`: `id`, `canvasId`, `blockId`, `createdBy`, `createdAt`.
  - `ShortlistViewSchema`: `projectId`, `blockIds[]` — derived view the
    frontend uses to render "pinned only" mode.

### 6. Agent event stream

- [ ] `src/agent/events.ts`:
  - `AgentMessageSchema`: `{ kind: 'message', role: 'user' | 'assistant', content: string, id: string }`.
  - `AgentToolCallSchema`: `{ kind: 'tool-call', toolName: string, args: JsonValue, callId: string }`.
  - `CanvasOpSchema` discriminated union:
    - `add-block` → `{ op: 'add-block', block: CanvasBlock }`
    - `update-block` → `{ op: 'update-block', blockId, patch: JsonValue }`
    - `remove-block` → `{ op: 'remove-block', blockId }`
  - `PinOpSchema` discriminated union:
    - `pin` → `{ op: 'pin', blockId }`
    - `unpin` → `{ op: 'unpin', blockId }`
  - `AgentEventSchema = z.discriminatedUnion('kind', [message, toolCall, canvasOp, pinOp])`
    — wrap ops in `{ kind: 'canvas-op', ... }` / `{ kind: 'pin-op', ... }`
    for a single event stream.

### 7. Barrel + exports

- [ ] `src/index.ts` re-exports every schema + type from the files above.
- [ ] Group exports by domain in the barrel so consumers can read it top-down.
- [ ] Confirm `packages/shared/package.json` exports field still points at
      `./src/index.ts` (dev) — dual-build (dist) can come later if needed.

### 8. Smoke checks

- [ ] `pnpm --filter @brandfactory/shared typecheck` passes.
- [ ] `pnpm --filter @brandfactory/shared lint` passes.
- [ ] In `packages/server/src/index.ts` and `packages/web/src/main.tsx`
      (or wherever they import), add a throwaway `import { BrandSchema } from '@brandfactory/shared'` and a `BrandSchema.parse({...})` call. Typecheck both sides.
- [ ] Remove the throwaway imports once verified.
- [ ] Commit: `feat(shared): phase 1 — domain schemas and types`.

## Out of scope for Phase 1

- Drizzle schema / migrations — lands in Phase 2 and consumes these types.
- Suggested-category *management* (admin UI to edit the seed list) — seed is
  a static array for v1; move to DB later if brands want to curate their
  own starter libraries.
- Yjs/collab types — body stays as generic ProseMirror JSON; revisit when
  we commit to CRDT.
- Agent prompt assembly — Phase 5 consumes these types to build prompts,
  but no prompt code lives in `shared`.

## Open questions to resolve before starting

- [ ] Confirm we want `createdBy: 'user' | 'agent'` on sections (useful for
      agent-authored content attribution) or drop it for v1 simplicity.
- [ ] Confirm `priority` is an integer (sparse ordering, re-balance on
      conflict) vs. a fractional string (lexorank-style) — integer is fine
      for v1; revisit if reorder churn becomes visible.
- [ ] Confirm whether `ShortlistView` is a stored entity or purely derived
      from `Pin` rows. Leaning derived — it's just a filter over pins.
