# Phase 7 Completion — Steps 0–2

**Status:** Steps 0–2 complete. Steps 3–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md).
**Verification (post-Step 2):** `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` — all green across 9 workspaces. Test count: 167 (from 140 at 0.7.0, +27 from Step 0). `pnpm --filter @brandfactory/web build` produces `dist/` clean.

---

## Step 0 — Close the server gaps the frontend needs

The single largest backend touch in Phase 7, front-loaded so the frontend has a stable HTTP contract before any React code is written. Adds four read endpoints, five user canvas-op endpoints, and two authed blob signed-URL endpoints across three sub-steps.

### Surface added

```
packages/shared
├── src/project/canvas-op.ts    # CreateCanvasBlockInputSchema, UpdateCanvasBlockInputSchema
├── src/project/detail.ts       # ProjectDetailSchema, ProjectDetail
├── src/blob/upload.ts          # BlobUploadRequestSchema, ALLOWED_UPLOAD_MIMES, response schemas
└── src/index.ts                # re-exports all three new modules

packages/db
└── src/queries/canvas.ts       # getBlockById added

packages/server
├── src/db.ts                   # facade widened: getBlockById, updateBlock, softDeleteBlock
├── src/test-helpers.ts         # in-memory fakes for the three new helpers
├── src/routes/canvas.ts        # new — 7 user canvas-op routes
├── src/routes/canvas.test.ts   # 16 cases
├── src/routes/messages.ts      # new — GET /projects/:id/messages
├── src/routes/messages.test.ts # 5 cases
├── src/routes/blobs-auth.ts    # new — POST /blob-urls/upload-url, GET /blob-urls/:key{.+}/read-url
├── src/routes/blobs-auth.test.ts # 6 cases
├── src/routes/projects.ts      # GET /:id widened to return ProjectDetail
└── src/app.ts                  # auth guard + mount for the three new routers
```

---

### Step 0.1 — Read endpoints

#### `GET /projects/:id/canvas/blocks` → `CanvasBlock[]`

Thin wrapper around the existing `deps.db.listActiveBlocks(canvas.id)` call. The agent route already fetched this internally; this exposes it on the wire. Auth + project-access guard reused from `requireProjectAccess`.

#### `GET /projects/:id/shortlist` → `ShortlistView`

Single call to `deps.db.getShortlistView(project.id)`. Returns `{ blockIds: CanvasBlockId[] }`. Client-side shortlist filter in the canvas pane reads this on mount and after any pin/unpin mutation.

#### `GET /projects/:id/messages[?limit=n]` → `AgentMessage[]`

`packages/server/src/routes/messages.ts`. Optional `?limit` query param (Zod coerced to int, capped at 200, defaults to 40 in the DB query). Wraps `deps.db.listAgentMessages`. Returns oldest-first — consistent with the `listAgentMessages` subquery-reverse implementation in `@brandfactory/db`.

#### `GET /projects/:id` widened to `ProjectDetail`

`projects.ts`'s existing route now issues four parallel reads via `Promise.all` after loading the canvas, returning the full `ProjectDetail` shape:

```ts
ProjectDetail = Project & {
  canvas: Canvas
  blocks: CanvasBlock[]
  shortlistBlockIds: CanvasBlockId[]
  recentMessages: AgentMessage[]
  brand: BrandWithSections
}
```

Single round-trip on project load is worth the extra ~40-row selects. The shape is defined in `packages/shared/src/project/detail.ts` using `z.intersection(ProjectSchema, z.object({...}))` — not `.extend()` — because `ProjectSchema` is a `z.discriminatedUnion` and discriminated unions don't expose the `.extend()` method.

---

### Step 0.2 — User canvas-op endpoints

All five mutating routes live in `packages/server/src/routes/canvas.ts` and follow the same **DB write → event log append → realtime publish** invariant the agent applier respects. Human and agent paths produce bit-identical realtime events so sibling clients can't distinguish them.

#### Shared helpers in `canvas.ts`

```ts
emitCanvasOp(deps, ctx, block, dbOp, wireOp: CanvasOp)
emitPinOp(deps, ctx, block, dbOp, wireOp: PinOp)
requireBlock(db, blockId: CanvasBlockId, canvasId: CanvasId): Promise<CanvasBlock>
```

`emitCanvasOp` appends a `canvas_events` row then publishes `{ kind: 'canvas-op', op: wireOp }` on `project:<projectId>`. `emitPinOp` mirrors for pin events. `requireBlock` fetches a block by ID and throws 404 if it doesn't exist, belongs to a different canvas, or is soft-deleted — prevents mutations leaking across project boundaries.

#### `POST /projects/:id/canvas/blocks` → `CanvasBlock` (201)

Body: `CreateCanvasBlockInputSchema` — a `z.discriminatedUnion('kind', [...])` over `text`, `image`, and `file` shapes, each with optional `position`. If `position` is omitted the server computes `max(existing block positions) + 1000`. The max-plus-1000 strategy matters because `canvas_blocks.position` is PostgreSQL `integer` (32-bit, max ~2.1B) — using `Date.now()` (~1.7T ms) would overflow.

#### `PATCH /projects/:id/canvas/blocks/:blockId` → `CanvasBlock`

Body: `UpdateCanvasBlockInputSchema` — a flat partial (`position?`, `body?`, `alt?`, `width?`, `height?`). Block ownership verified via `requireBlock` before the update. The update payload is cast `as unknown as JsonValue` when stored in `appendCanvasEvent.payload` because `UpdateCanvasBlockInput` has `T | undefined` fields that are not directly assignable to the `JsonValue` union.

#### `POST /projects/:id/canvas/blocks/:blockId/pin` and `.../unpin` → `CanvasBlock`

Calls `deps.db.setPinned(blockId, true|false)`, then `emitPinOp`. Returns the updated block.

#### `DELETE /projects/:id/canvas/blocks/:blockId` → 204

Soft-deletes via `deps.db.softDeleteBlock(blockId)` (sets `deleted_at = now()`). Returns `new Response(null, { status: 204 })` with no body. The vision's "discarded ideas aren't gone, just hidden" requirement is honoured — a restore affordance is deferred.

#### `getBlockById` added to `@brandfactory/db` and the `Db` facade

Rather than loading all active blocks to find one target, a dedicated `getBlockById(id)` query (5 lines in `packages/db/src/queries/canvas.ts`) enables O(1) ownership verification in `requireBlock`. Added to the `Db` interface and `buildDbDeps()` in `packages/server/src/db.ts`, plus a fake in `test-helpers.ts`.

`updateBlock` and `softDeleteBlock` were also exposed on the facade (they existed in `@brandfactory/db` but hadn't been wired into the server facade or test helpers yet).

---

### Step 0.3 — Blob signed-URL mint endpoints

Both routes live in `packages/server/src/routes/blobs-auth.ts`, mounted under `/blob-urls/*` in `app.ts` with the auth middleware applied at that prefix. The existing `/blobs/*` prefix stays auth-free because the signed URL *is* the capability; putting the mint endpoints under a different prefix avoids a negative-lookahead exception in the auth middleware config.

#### `POST /blob-urls/upload-url` → `{ key, url, headers? }`

Validates `contentType` against `ALLOWED_UPLOAD_MIMES` (image/jpeg, png, gif, webp, svg+xml, application/pdf, Word docs, text/plain — defined as a `const` tuple in `packages/shared/src/blob/upload.ts`). Checks `size <= BLOB_MAX_BYTES` (25 MiB). Generates the key as `uploads/<yyyy>/<mm>/<uuid>-<safe-filename>` using `randomUUID` from `node:crypto`. Calls `deps.storage.getSignedWriteUrl(key, { contentType, ttlSeconds: 300 })` and returns `{ key, url, headers }`.

Content-type validation returns 400 `INVALID_CONTENT_TYPE`. Size check returns 413 (matching the existing `/blobs` upload guard). The key format is designed for one-way traceability: the year/month prefix is indexable by time; the UUID prevents guessing.

#### `GET /blob-urls/:key{.+}/read-url` → `{ url }`

Multi-segment key capture using Hono's regex path syntax `/:key{.+}` — necessary because blob keys contain slashes (e.g. `uploads/2024/04/uuid-name.jpg`). Calls `deps.storage.getSignedReadUrl(key)` and returns `{ url }`. Auth is sufficient access control for v1 (single-seat self-hosted); cross-workspace blob authz is flagged for a later hardening pass.

---

### Step 0 tests (+27)

Each new route gets 3–6 vitest cases against the in-memory `Db` and a capturing fake `RealtimeBus`, patterned on `routes/agent.test.ts`.

| File | Cases | What's covered |
|------|-------|----------------|
| `routes/canvas.test.ts` | 16 | 401/404 per route; happy-path with realtime assertion; position auto-computation; soft-delete idempotency (second delete → 404) |
| `routes/messages.test.ts` | 5 | 401; 404; empty array; oldest-first ordering; `?limit` param |
| `routes/blobs-auth.test.ts` | 6 | 401; 400 `INVALID_CONTENT_TYPE`; 413; upload URL key format assertion (regex); 401 read-url; read-url happy path |

Total after Step 0: **167 tests** (140 → +27; plan estimated ~30).

---

## Step 1 — Vite + React scaffold

**Outcome:** `pnpm --filter @brandfactory/web dev` boots a Vite dev server on `:5173`. `pnpm --filter @brandfactory/web build` produces `packages/web/dist`. Typecheck, lint, and the full test suite remain green.

### Surface added/changed

```
packages/web
├── index.html                  # new — Vite entry document
├── vite.config.ts              # new — React plugin, @/ alias, dev proxy
├── vitest.config.ts            # new — jsdom environment for this package
├── package.json                # scripts added; react/react-dom deps; vite/plugin devDeps
├── tsconfig.json               # jsx: 'react-jsx', paths: { '@/*': ['./src/*'] }
├── src/main.tsx                # replaces src/index.ts scaffold
└── src/App.tsx                 # new — renders <h1>BrandFactory</h1>

root
├── vitest.config.ts            # 'packages/web' added to projects array
└── eslint.config.js            # React + react-hooks + jsx-a11y rules scoped to packages/web/src/**
```

### `vite.config.ts`

Three concerns:

- **React plugin** (`@vitejs/plugin-react`) — JSX transform, fast refresh.
- **`@/` path alias** → `src/` via `fileURLToPath(new URL('./src', import.meta.url))`, mirrored in `tsconfig.json`'s `paths` so TypeScript and the bundler agree.
- **Dev proxy** — `/api` proxies to `http://localhost:3001` (strips the prefix via `rewrite`), `/rt` proxies to `ws://localhost:3001/rt` with `ws: true`. Dev frontend hits the real backend without CORS gymnastics; prod assumes a reverse proxy.

### `tsconfig.json`

Added `"jsx": "react-jsx"` (automatic JSX transform — no `import React` needed in component files) and `"paths": { "@/*": ["./src/*"] }`. The base's `"moduleResolution": "Bundler"` supports path aliases natively.

### ESLint

Three plugins (`eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`) added to root `devDependencies`. A scoped config block in `eslint.config.js` applies their recommended rules only to `packages/web/src/**/*.{ts,tsx}`, with `react/react-in-jsx-scope` and `react/prop-types` disabled (irrelevant with automatic JSX transform and TypeScript types respectively).

### `vitest.config.ts` (web package)

```ts
defineProject({
  test: {
    name: '@brandfactory/web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
})
```

Added to the root `vitest.config.ts` projects array. The comment already present in the root config anticipated this: *"per-package configs widen the environment when `web` lands and needs `jsdom`."*

### Dependencies added

- **`dependencies`**: `react@^19`, `react-dom@^19`.
- **`devDependencies`**: `@vitejs/plugin-react`, `vite`, `@types/react`, `@types/react-dom`.
- **Root `devDependencies`**: `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`.

React 19 was resolved by pnpm (latest at install time); no API changes from 18 affect this step.

---

## Step 2 — Tailwind v4 + shadcn/ui primitives

**Outcome:** Tailwind v4 configured via `@tailwindcss/vite` (no PostCSS config needed), shadcn CSS variables layer in `src/index.css`, seven UI primitives available at `@/components/ui/*`.

**Choice documented (plan §Step 2):** Tailwind v4 with `@tailwindcss/vite` over v3 + PostCSS. v4 is stable and the Vite plugin integrates directly into the bundler pipeline — no `postcss.config.js` to maintain.

### Surface added/changed

```
packages/web
├── vite.config.ts                       # tailwindcss() added to plugins
├── components.json                      # shadcn CLI config (style: default, baseColor: slate)
├── src/index.css                        # Tailwind v4 import, CSS variables, base layer
├── src/main.tsx                         # import './index.css' added
├── src/lib/utils.ts                     # cn() via clsx + tailwind-merge
└── src/components/ui/
    ├── button.tsx                       # Button + buttonVariants (cva)
    ├── input.tsx                        # Input
    ├── label.tsx                        # Label (Radix @radix-ui/react-label)
    ├── card.tsx                         # Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
    ├── select.tsx                       # Select family (Radix @radix-ui/react-select)
    ├── dialog.tsx                       # Dialog family (Radix @radix-ui/react-dialog)
    └── sonner.tsx                       # Toaster (wraps sonner with CSS variable overrides)
```

### `src/index.css` — Tailwind v4 setup

```css
@import 'tailwindcss';
@plugin 'tailwindcss-animate';
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  /* … maps all CSS variables to Tailwind color utilities … */
}

@layer base {
  :root { /* oklch-based slate-ish palette, light */ }
  .dark { /* … dark palette … */ }
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; font-family: system-ui … }
}
```

Key differences from v3:

- `@import 'tailwindcss'` replaces `@tailwind base/components/utilities`.
- `@plugin 'tailwindcss-animate'` replaces the PostCSS plugin entry in `tailwind.config.js` (v4 supports inline plugin directives).
- `@custom-variant dark (...)` wires up class-based dark mode — `.dark` on any ancestor activates the variant.
- `@theme inline { --color-*: var(--*) }` maps the custom CSS variables to Tailwind's color utility namespace so `bg-background`, `text-foreground` etc. work without a `tailwind.config.js` content or color extension.

**Colour palette:** neutral, slate-ish, oklch-based (same values shadcn's "default" theme generates). Single accent is slate; subject to design polish later as the plan notes.

**Dark mode:** class-based via `.dark` on `<html>`. The `@custom-variant` makes `dark:bg-background` work as `&:is(.dark *) { background: var(--background) }`. Toggle wired in Step 7's shell.

### Component design notes

All seven components follow the current shadcn source conventions:

- Function-style declarations (no `React.forwardRef` — React 19 passes refs as props on standard elements; Radix primitives handle their own ref forwarding).
- `ComponentProps<typeof Primitive.Root>` pattern for typed props without repeating the Radix type.
- `import type { ComponentProps } from 'react'` for type-only imports — required by `verbatimModuleSyntax: true` in the base tsconfig.
- `cn()` from `@/lib/utils` for all `className` merging.
- `data-slot="*"` attributes for styling hooks.

**`sonner.tsx`** wraps the `Toaster` from the `sonner` package with CSS variable overrides for `--normal-bg`, `--normal-border`, etc., pointing at the shared `--popover` / `--border` / `--popover-foreground` variables. This keeps toast theming consistent with the rest of the palette without a second token set.

### `components.json`

```json
{
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "slate", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", ... }
}
```

The `tailwind.config` field is empty string (v4 has no config file). Presence of this file means future `pnpm dlx shadcn@latest add <component>` calls from within `packages/web` can install additional primitives without re-initialising.

### Dependencies added

- **`dependencies`**: `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`, `@radix-ui/react-slot`, `@radix-ui/react-select`, `@radix-ui/react-dialog`, `@radix-ui/react-label`.
- **`devDependencies`** (web): `tailwindcss`, `@tailwindcss/vite`, `tailwindcss-animate`.

### Build output

`pnpm --filter @brandfactory/web build` produces `dist/assets/index-*.css` at ~24 KB gzipped (~5 KB gzip). No warnings. The Tailwind engine only emits utilities actually referenced in source — the CSS bundle will grow proportionally to Step 3–12's component usage.

---

## Verification (after Step 2)

```
pnpm install        ✔  lockfile updated; web workspace has all deps resolved
pnpm typecheck      ✔  9/9 workspaces clean (web included)
pnpm lint           ✔  clean (React + jsx-a11y rules applied to packages/web/src/**)
pnpm format:check   ✔  clean
pnpm test           ✔  167 tests (32 files) — Step 0 +27; Steps 1–2 add no new test cases
pnpm --filter @brandfactory/web build
                    ✔  dist/ produced; CSS ~24 kB, JS ~190 kB (React 19 + Radix)
```

---

## Items deferred from Steps 0–2

- **Optimistic canvas mutations.** Every user canvas-op round-trips today; for typing into a TipTap block this is acceptable (debounced), for pin toggles it's visible latency. Optimistic apply + rollback is a post-Phase-7 hardening item.
- **Canvas block restore UI.** Soft-delete is implemented server-side; no "trash" view or restore endpoint yet.
- **Cross-workspace blob read authz.** `/blob-urls/:key/read-url` mints for any authed user. Scope to workspace once >1 seat exists.
- **`@brandfactory/web` test cases for Steps 1–2.** No new tests were needed — Vite scaffold and CSS setup have no testable logic units. Component tests land in Step 15.
