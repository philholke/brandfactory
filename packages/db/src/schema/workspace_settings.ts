import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'

// Singleton row per workspace. `llm_provider_id` is stored as plain text so
// the shipped-provider enum can widen in `@brandfactory/shared` without a
// schema migration. The trust boundary is `upsertWorkspaceSettings` /
// `getWorkspaceSettings` in `queries/workspace-settings.ts` — both validate
// against `LLMProviderIdSchema` so nothing past the helper sees an unknown
// provider id. API keys stay env-only per locked decision 9 (DB persistence
// needs at-rest encryption — deferred).
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  llmProviderId: text('llm_provider_id').notNull(),
  llmModel: text('llm_model').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})
