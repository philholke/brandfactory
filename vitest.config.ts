import { defineConfig } from 'vitest/config'

// The workspace layout lives in `vitest.workspace.ts` (vitest auto-loads it);
// each package's `vitest.config.ts` owns its own environment/alias/setup. The
// root config stays minimal and only holds cross-workspace defaults should we
// need them in the future.
export default defineConfig({})
