# BrandFactory — Architecture Blueprint

This document describes the technical architecture for BrandFactory. It is the
reference for *how* we build what [vision.md](./vision.md) describes.

## Guiding principles

1. **Self-hosted first.** Any stack choice must ship cleanly as a Docker image
   someone can run on their own box. No hard dependency on a proprietary cloud.
2. **Provider-agnostic at the seams.** Database, blob storage, auth, and LLM
   providers sit behind thin ports. Supabase, OpenAI, and Postgres are default
   adapters — never baked into domain code.
3. **One language, end-to-end.** TypeScript across frontend, backend, and
   shared packages. Shared types are the contract between the agent, canvas,
   and brand schema.
4. **Minimalist core, extensible surface.** The core repo stays small. Project
   templates, integrations, and model providers are pluggable modules.
5. **Brand context is first-class.** Every API, every agent call, every canvas
   operation carries brand context implicitly. It is never re-passed by hand.

## Stack at a glance

| Layer           | Choice                                                  |
| --------------- | ------------------------------------------------------- |
| Frontend        | Vite + React + TypeScript                               |
| Styling / UI    | TailwindCSS + shadcn/ui                                 |
| Canvas (text)   | TipTap (ProseMirror)                                    |
| Canvas (board)  | dnd-kit (+ tldraw/excalidraw later if needed)           |
| Chat UI         | Vercel AI SDK UI (`useChat`, streaming hooks)           |
| Backend runtime | Node.js + TypeScript                                    |
| HTTP framework  | Hono                                                    |
| ORM             | Drizzle                                                 |
| Database        | PostgreSQL (Supabase by default, any Postgres works)    |
| LLM SDK         | Vercel AI SDK core (OpenRouter + Anthropic + others)    |
| Auth            | Supabase Auth adapter (pluggable)                       |
| Blob storage    | Supabase Storage adapter (pluggable: S3, local disk)    |
| Realtime        | WebSocket layer behind an adapter (Supabase Realtime /  |
|                 | native ws as alternatives)                              |
| Package manager | pnpm workspaces (monorepo)                              |

## Why these choices

### Vite + React (not Next, not Vue)

- With a dedicated Node backend, Next's SSR / server components / route
  handlers add conceptual weight for no gain. Vite gives a faster dev loop and
  a plain SPA that self-hosts as static files behind any web server.
- The AI-app ecosystem is React-first: Vercel AI SDK UI, assistant-ui,
  shadcn/ui, TipTap React integrations, dnd-kit, tldraw, react-flow. Building
  the "agent chat + live canvas" surface in Vue means fighting the ecosystem.
- Escape hatch for public brand pages (shareable published guidelines): add a
  small Astro or Next app *later*, consuming the same backend. Don't
  pre-optimize.

### Hono on Node

- Lightweight, fast, first-class TypeScript DX.
- Runs on Node, Bun, Deno, and edge runtimes without code changes — keeps
  deployment options open.
- Small surface area, easy for contributors to read end-to-end.

### Drizzle + plain `pg`

- Type-safe, SQL-first, no heavy runtime. Works against any Postgres.
- Migrations live in the repo as plain SQL + generated artifacts, not locked
  to a vendor's migration system.
- Supabase is consumed via `pg` connection string like any other Postgres.
  Supabase-specific features (Auth, Storage, Realtime) are accessed through
  adapter interfaces, never mixed into data access code.

### Vercel AI SDK core

- Unified streaming + tool-calling API across OpenAI, Anthropic, Google,
  Mistral, Ollama, local models, etc. Directly supports the
  "bring-your-own-provider" principle.
- **OpenRouter** ships via `@openrouter/ai-sdk-provider` and slots in next
  to native providers. Users can mix-and-match: OpenRouter for breadth of
  model choice, Anthropic native for direct billing, Ollama for local. The
  active provider + model is configurable per workspace from the frontend
  settings page, persisted against the user/workspace, and read by the LLM
  adapter at call time.

## Repository layout

A pnpm workspaces monorepo with a **flat `packages/*`** structure — every
workspace is a peer. No `apps/` vs `packages/` split: the deployable/library
distinction is communicated by package name and README, not folder hierarchy.

```
brandfactory/
├── packages/
│   ├── web/              # Vite + React frontend (deployable)
│   ├── server/           # Hono + Node backend (deployable)
│   ├── shared/           # Shared types, zod schemas, domain contracts
│   ├── db/               # Drizzle schema, migrations, query helpers
│   ├── agent/            # Server-side LLM orchestration: prompts, tools,
│   │                     # brand-context assembly, canvas-awareness
│   └── adapters/         # Ports + default implementations
│       ├── auth/         # supabase, (future: local, oidc)
│       ├── storage/      # supabase, s3, local-disk
│       ├── realtime/     # supabase, native-ws
│       └── llm/          # AI SDK provider factory (OpenRouter, Anthropic,
│                         # OpenAI, Ollama, ...)
├── docs/
├── docker/               # docker-compose, Dockerfiles
└── scripts/              # dev/setup/release scripts
```

Package names are scoped: `@brandfactory/web`, `@brandfactory/server`,
`@brandfactory/shared`, `@brandfactory/db`, `@brandfactory/agent`,
`@brandfactory/adapter-auth`, etc. Folder names stay short; the scope keeps
imports readable and avoids collisions if any are ever published.

## Module boundaries

### `packages/shared`

The single source of truth for domain types consumed by both sides:

- Brand guidelines schema (voice, audience, values, visual, messaging, custom
  freeform fields).
- Workspace, Project, Canvas, CanvasBlock, Pin, ShortlistView.
- Agent event stream types (message, tool call, canvas-op, pin-op).
- Zod schemas for runtime validation at HTTP / WS boundaries.

No runtime dependencies beyond `zod`. Importable from both browser and server.

### `packages/db`

- Drizzle schema definitions keyed off `packages/shared` types.
- Migration files (generated + hand-authored SQL).
- Query helpers grouped by aggregate (brand, project, canvas).
- No HTTP, no auth, no business rules.

### `packages/agent`

The single home for all AI-orchestration logic. **Backend-consumed** —
imported only by `packages/server`, never by `packages/web`. API keys stay
server-side, tool handlers mutate the DB, and streaming is proxied to the
client as SSE. The shared *contract* (event shapes, tool-call signatures)
lives in `packages/shared` so the frontend can render streamed events
without depending on agent internals.

Responsibilities:

- Builds the system prompt from brand guidelines.
- Assembles canvas state into tool-visible context (what's pinned, what's
  unpinned, recent deltas).
- Defines canvas-manipulation tools the agent can call (add block, pin, mark
  shortlist candidate) and future tools (integrations, exports).
- Streams responses back to the caller as typed events.
- Future home for multi-step workflows, multi-agent flows, eval harness
  hooks.

### `packages/adapters`

An **adapter** is a thin implementation of a port interface that lets domain
code depend on *the capability*, not *the vendor*. The server asks for a
`BlobStore`; env config decides whether it gets `SupabaseBlobStore` or
`LocalDiskBlobStore`. Supabase never appears in domain code — swapping to
S3, local disk, or OIDC auth is an isolated change.

Ports (minimum initial set):

- `AuthProvider` — `verifyToken`, `getUser`, `listUsers`
- `BlobStore` — `put`, `get`, `getSignedUrl`, `delete`
- `RealtimeBus` — `publish(channel, event)`, `subscribe(channel, handler)`
- `LLMProvider` — factory returning a configured AI SDK model based on
  user/workspace settings (OpenRouter, Anthropic native, OpenAI, Ollama,
  etc.). Multiple providers can be installed simultaneously; the active one
  is chosen per call from persisted settings written by the frontend.

Default implementations live alongside each port. The `server` package wires
them together at boot from env config. No adapter leaks into domain
packages.

## Data flow: a typical ideation round

1. User opens a Project in the web app. Frontend fetches workspace + project
   state over HTTP, subscribes to the project's realtime channel.
2. User drops an image on the canvas. Frontend uploads via `BlobStore.put`,
   emits a `canvas-op` over realtime. Backend persists the block via
   `packages/db` and re-broadcasts.
3. User sends a message. Frontend streams it to `POST /projects/:id/agent`.
4. `packages/server` loads brand context, assembles canvas state, calls
   `packages/agent` (which asks `adapters/llm` for the active model based on
   the user's workspace settings). Agent streams tokens + tool calls.
5. Tool calls (e.g. "add 5 tagline blocks") are applied as canvas-ops,
   persisted, broadcast — so any collaborator sees them live.
6. User pins a block. Pin state is a canvas-op, same path.
7. User promotes a pinned block into the brand's finalized guidelines. That is
   a write against the brand aggregate, again broadcast.

## Self-hosting story

- **Default deployment:** `docker compose up` boots `web`, `server`, and
  Postgres. Env flags toggle Supabase vs. local adapters.
- **Minimal deployment:** a single image serving static web assets + server,
  pointing at any Postgres (Supabase, RDS, local). Local disk blob store and
  native-ws realtime mean zero third-party dependencies.
- **Cloud deployment:** point adapters at Supabase for auth/storage/realtime;
  point LLM adapter at a hosted provider.

## Extensibility surface

Community extensions plug in at well-defined points:

- **Project templates** — register a template module that contributes a
  schema, a UI component, and optional agent tools. The freeform canvas is
  the default; standardized projects (e.g., social content calendar) are
  templates.
- **Integrations** — a module contributing outbound actions (publish to
  Buffer, export to Figma, push to a CMS). Surfaced in the agent as tools
  and in the UI as action buttons.
- **LLM providers** — any provider conforming to the AI SDK provider
  interface.
- **Adapters** — auth, storage, realtime swappable without touching domain
  code.

Extension authors only need TypeScript — no second stack to learn.

## Out of scope (explicit)

- SSR / SEO for the app shell. If we need public shareable pages, that is a
  separate small app.
- Collaborative cursors / CRDT-grade multi-user editing on the canvas in v1.
  Realtime broadcast of discrete canvas-ops is sufficient.
- Fine-tuning, embeddings pipelines, eval harnesses inside the core repo.
  If needed later, run as a Python sidecar behind HTTP.
- Hosted SaaS distribution with billing. Self-hosted is the product.

## Decisions pending

- Auth strategy for local / self-hosted deployments without Supabase (likely
  an `AuthProvider` implementation backed by a local users table + OIDC).
- Canvas conflict resolution model when two users edit simultaneously
  (last-write-wins per block is probably fine for v1; revisit if real
  collaboration demand emerges).
- Whether the agent runs in the server process or a dedicated worker. Start
  in-process; split when latency/throughput demands it.
- Where LLM provider settings (active provider, model, API keys) live —
  workspace-level vs. user-level, and whether API keys are encrypted at
  rest in Postgres or kept server-side only via env.
