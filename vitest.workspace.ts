// Workspace file for vitest. Each entry points to a per-package `vitest.config.ts`
// so environment/setup/alias settings from the package config (jsdom + `@/*`
// alias for web, node for everything else) actually apply when tests are run
// from the root. `test.projects` in the root config silently dropped the
// per-project `environment` and `resolve.alias` when orchestrated from the
// top level; the workspace-file form honors them.
export default [
  'packages/adapters/auth/vitest.config.ts',
  'packages/adapters/storage/vitest.config.ts',
  'packages/adapters/realtime/vitest.config.ts',
  'packages/adapters/llm/vitest.config.ts',
  'packages/agent/vitest.config.ts',
  'packages/db/vitest.config.ts',
  'packages/server/vitest.config.ts',
  'packages/web/vitest.config.ts',
]
