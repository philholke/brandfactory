import { z } from 'zod'
import { WorkspaceIdSchema } from '../ids'
import { LLMProviderIdSchema } from '../llm/provider-ids'

export const WorkspaceSettingsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  llmProviderId: LLMProviderIdSchema,
  llmModel: z.string().min(1),
  updatedAt: z.iso.datetime(),
})

export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>

// `workspaceId` arrives via path param, so it's not in the body.
export const UpdateWorkspaceSettingsInputSchema = z.object({
  llmProviderId: LLMProviderIdSchema,
  llmModel: z.string().min(1),
})

export type UpdateWorkspaceSettingsInput = z.infer<typeof UpdateWorkspaceSettingsInputSchema>

// Response shape for GET /workspaces/:id/settings. `source` makes it explicit
// whether the values come from a workspace row or the env fallback.
export const ResolvedWorkspaceSettingsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  llmProviderId: LLMProviderIdSchema,
  llmModel: z.string().min(1),
  source: z.enum(['workspace', 'env']),
})

export type ResolvedWorkspaceSettings = z.infer<typeof ResolvedWorkspaceSettingsSchema>
