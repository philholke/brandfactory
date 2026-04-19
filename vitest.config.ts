import { defineConfig } from 'vitest/config'

// Projects mode: each workspace ships its own vitest.config.ts so per-package
// `pnpm --filter <pkg> test` works the same as the root `pnpm test`. Phase 3
// adapters all run in `node`; per-package configs widen the environment when
// `web` lands and needs `jsdom`.
export default defineConfig({
  test: {
    projects: [
      'packages/adapters/auth',
      'packages/adapters/storage',
      'packages/adapters/realtime',
      'packages/adapters/llm',
      'packages/server',
    ],
  },
})
