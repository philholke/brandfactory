# BrandFactory

**An open-source Brand Operating System for marketers, creators, and small teams.**

One brand context. Endless consistent creative. Self-hosted, privacy-first,
provider-agnostic — no vendor lock-in, no recurring fees, and the freedom to
run it with local models or your own stack.

---

## Why this exists

Brand context lives in too many places — a brand deck in Figma, a
tone-of-voice doc in Notion, audience personas on a slide somewhere, campaign
notes in Slack, a dozen half-remembered rules in the founder's head. Every
time someone opens a generic AI tool to draft an ad, name a product, or plan
a week of posts, they re-explain the brand from scratch — or skip it, and get
generic output that doesn't sound like the brand at all.

BrandFactory fixes that by making the brand the center of gravity. Define it
once. Every creative surface inherits it automatically.

## What it is

A **Brand** is a single source of truth — audience personas, voice,
positioning, visual guidelines, messaging frameworks, and whatever else
matters. Brands live in **Workspaces**. Creative work happens inside
**Projects** attached to a workspace, with a universal flow:
**Ideate → Iterate → Finalize**.

Inside a project, the default surface is a split-screen workspace: an agent
chat on one side with full brand context, a freeform multimodal canvas on
the other. Brainstorm, pin the ideas worth keeping, iterate down to a
shortlist, and promote winners into your finalized brand guidelines.

There is no dedicated "naming agent" or "copy agent" — just one brainstorming
surface that produces taglines, content calendars, packaging concepts, or
anything else, because the brand context always travels with it.

See [`docs/vision.md`](docs/vision.md) for the full product vision.

## Status

> **Pre-alpha — scaffolding in progress.**
>
> As of the current release (0.1.0), the vision, architecture, and repo
> foundation are in place. Phase 0 of the scaffolding plan is complete:
> `pnpm install`, `pnpm lint`, and `pnpm typecheck` all succeed on a flat
> pnpm monorepo with nine peer workspaces. **There is no runnable app yet.**
> Backend, database, frontend, and agent work land in subsequent phases —
> see [Roadmap](#roadmap) below.

## Guiding principles

- **Self-hosted first.** Runs cleanly on your own infrastructure. No hard
  dependency on a proprietary cloud.
- **Provider-agnostic at the seams.** Database, blob storage, auth, and LLM
  providers sit behind thin ports. Supabase, OpenAI, and Postgres are
  default adapters, not requirements.
- **Bring your own LLM.** OpenRouter, Anthropic native, OpenAI, local
  models via Ollama — all available simultaneously, selectable per
  workspace from the settings page.
- **One language, end-to-end.** TypeScript across frontend, backend, and
  shared packages. Community extensions only need to learn one stack.
- **Minimalist core, extensible surface.** Project templates, integrations,
  model providers, and storage backends all plug in as modules.
- **No lock-in.** Open-source, standard data formats, exportable at any
  time.

## Tech stack

| Layer           | Choice                                                         |
| --------------- | -------------------------------------------------------------- |
| Frontend        | Vite + React + TypeScript                                      |
| Styling / UI    | TailwindCSS + shadcn/ui                                        |
| Canvas          | TipTap (ProseMirror) + dnd-kit                                 |
| Chat UI         | Vercel AI SDK UI (streaming hooks)                             |
| Backend runtime | Node.js + TypeScript                                           |
| HTTP framework  | Hono                                                           |
| ORM             | Drizzle                                                        |
| Database        | PostgreSQL (Supabase by default, any Postgres works)           |
| LLM SDK         | Vercel AI SDK core (OpenRouter, Anthropic, OpenAI, Ollama, …)  |
| Auth / Storage  | Supabase adapters by default; pluggable (S3, local disk, OIDC) |
| Package manager | pnpm workspaces                                                |

See [`docs/architecture.md`](docs/architecture.md) for the rationale behind
each choice.

## Who it's for

- **Solo founders** building a brand from scratch, who need a structured
  place to develop and refine brand identity without hiring an agency.
- **Marketers and in-house teams at small companies**, especially those
  juggling multiple brands or sub-brands, who need consistency without
  rebuilding context every time they open an AI tool.
- **Creators** who are their own brand and want their brand voice baked
  into everything they generate.
- **Small agencies** managing a portfolio of client brands, who need each
  brand's context cleanly separated and instantly available.

## Repository layout

Flat pnpm monorepo. Every workspace is a peer.

```
brandfactory/
├── packages/
│   ├── web/              # Vite + React frontend
│   ├── server/           # Hono + Node backend
│   ├── shared/           # Types, Zod schemas, domain contracts
│   ├── db/               # Drizzle schema, migrations, query helpers
│   ├── agent/            # Server-side LLM orchestration (prompts, tools)
│   └── adapters/         # Ports + default implementations
│       ├── auth/
│       ├── storage/
│       ├── realtime/
│       └── llm/          # OpenRouter, Anthropic, OpenAI, Ollama, ...
├── docs/                 # Vision, architecture, plans, completion records
└── scripts/
```

## Getting started

### Prerequisites

- Node.js **≥ 20.11** (LTS)
- pnpm **≥ 10**

### Install and verify

```bash
git clone https://github.com/<your-org>/brandfactory.git
cd brandfactory
pnpm install
pnpm lint
pnpm typecheck
```

All three should succeed on a fresh clone. That's the Phase 0 contract.

### Running the app

There is nothing to run yet. Phase 1 onwards adds real workspaces; the
smoke-check flow will be `docker compose up` once Phase 8 lands. Follow
along via the [scaffolding plan](docs/executing/scaffolding-plan.md) and
the [changelog](docs/changelog.md).

## Roadmap

Incremental, phase-gated. Each phase ends with a runnable smoke check so
progress is always verifiable. Full detail in
[`docs/executing/scaffolding-plan.md`](docs/executing/scaffolding-plan.md).

| Phase | Deliverable                                          | Status   |
| ----- | ---------------------------------------------------- | -------- |
| **0** | Repo foundation (pnpm workspaces, TS, lint, format)  | Complete |
| **1** | `@brandfactory/shared` — domain types + Zod schemas  | Up next  |
| **2** | `@brandfactory/db` — Drizzle schema + migrations     | Planned  |
| **3** | `@brandfactory/adapters/*` — ports + defaults        | Planned  |
| **4** | `@brandfactory/server` — Hono, routes, realtime      | Planned  |
| **5** | `@brandfactory/agent` — prompt assembly, tools       | Planned  |
| **6** | Agent endpoint wired end-to-end (SSE streaming)      | Planned  |
| **7** | `@brandfactory/web` — split-screen UI, settings page | Planned  |
| **8** | Dev & deploy tooling (Docker, CI, seed, env)         | Planned  |
| **9** | Hardening pass (errors, logging, tests)              | Planned  |

Beyond scaffolding: standardized project templates (first one is a
minimalist social media content calendar), third-party integrations, public
shareable brand pages.

## Documentation

All docs live under [`docs/`](docs/).

- [`vision.md`](docs/vision.md) — full product vision
- [`highlevel-vision.md`](docs/highlevel-vision.md) — elevator pitch
- [`architecture.md`](docs/architecture.md) — technical blueprint
- [`executing/scaffolding-plan.md`](docs/executing/scaffolding-plan.md) —
  phase-by-phase implementation plan
- [`completions/`](docs/completions/) — record of what each phase actually
  shipped, and why
- [`changelog.md`](docs/changelog.md) — release history

## Contributing

BrandFactory is early. The biggest ways to help right now:

- **Read the vision and architecture docs and push back.** If a decision
  doesn't hold up, we'd rather revise it before it's load-bearing.
- **Sanity-check the scaffolding plan.** Phase ordering, missing pieces,
  smoke checks that don't actually prove what they claim — all fair game.
- **Build with it** once Phase 4 or Phase 7 lands, and file what breaks.

Formal contribution guidelines (code style, PR flow, governance) will land
alongside CI in Phase 8.

## License

[MIT](LICENSE).
