import type { LLMProviderId, WorkspaceId, WorkspaceSettings } from '@brandfactory/shared'
import { LLMProviderIdSchema } from '@brandfactory/shared'
import { eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { workspaceSettings } from '../schema'

type WorkspaceSettingsRow = typeof workspaceSettings.$inferSelect

// `llm_provider_id` is stored as `text` (not a pgEnum) so adding a future
// provider doesn't need a migration — but that means internal callers can in
// principle write any string. Validating here on read *and* write makes this
// helper the trust boundary: nothing past this point sees a provider id that
// isn't in `LLM_PROVIDER_IDS`. A widened enum that hasn't reached production
// yet still surfaces loudly instead of silently corrupting downstream typing.
function rowToWorkspaceSettings(row: WorkspaceSettingsRow): WorkspaceSettings {
  return {
    workspaceId: row.workspaceId as WorkspaceId,
    llmProviderId: LLMProviderIdSchema.parse(row.llmProviderId),
    llmModel: row.llmModel,
    updatedAt: row.updatedAt,
  }
}

export async function getWorkspaceSettings(
  workspaceId: WorkspaceId,
): Promise<WorkspaceSettings | null> {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
  return row ? rowToWorkspaceSettings(row) : null
}

export async function upsertWorkspaceSettings(input: {
  workspaceId: WorkspaceId
  llmProviderId: LLMProviderId
  llmModel: string
}): Promise<WorkspaceSettings> {
  // Runtime check guards against `as`-cast / hand-rolled-SQL writers that
  // would slip past the `LLMProviderId` parameter type.
  const llmProviderId = LLMProviderIdSchema.parse(input.llmProviderId)
  const [row] = await db
    .insert(workspaceSettings)
    .values({
      workspaceId: input.workspaceId,
      llmProviderId,
      llmModel: input.llmModel,
    })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: {
        llmProviderId,
        llmModel: input.llmModel,
        updatedAt: sql`now()`,
      },
    })
    .returning()
  if (!row) throw new Error('upsertWorkspaceSettings returned no row')
  return rowToWorkspaceSettings(row)
}
