# Changelog

Latest releases at the top. Each version has a one-line entry in the index
below, with full detail further down.

## Index

- **0.1.0** — 2026-04-18 — Project bootstrap: vision, architecture blueprint, scaffolding plan, and Phase 0 repo foundation.

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
