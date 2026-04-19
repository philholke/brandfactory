import type { ResolvedWorkspaceSettings, WorkspaceId } from '@brandfactory/shared'
import type { Db } from './db'
import type { Env } from './env'

// Merge a workspace's persisted settings with the env defaults. The settings
// row is the override; `LLM_PROVIDER` + `LLM_MODEL` in env are the fallback.
// Phase 6 consumes this from the agent endpoint; Phase 4 exposes it through
// the settings route.
export async function resolveLLMSettings(
  workspaceId: WorkspaceId,
  env: Env,
  deps: Pick<Db, 'getWorkspaceSettings'>,
): Promise<ResolvedWorkspaceSettings> {
  const row = await deps.getWorkspaceSettings(workspaceId)
  if (row) {
    return {
      workspaceId,
      llmProviderId: row.llmProviderId,
      llmModel: row.llmModel,
      source: 'workspace',
    }
  }
  return {
    workspaceId,
    llmProviderId: env.LLM_PROVIDER,
    llmModel: env.LLM_MODEL,
    source: 'env',
  }
}
