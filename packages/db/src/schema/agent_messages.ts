import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { users } from './users'

export const agentMessageRole = pgEnum('agent_message_role', ['user', 'assistant'])

// Agent turn log. A separate table from `canvas_events` because a turn's
// assistant reply doesn't necessarily mutate the canvas — modelling them
// together would mean mixing semantics or missing rows. `content` is plain
// text in v1 (matches the shared `AgentMessage.content` string); move to
// `jsonb` if we later carry reasoning/citations/mixed parts.
// `user_id` is nullable because assistant rows have no user; user rows
// survive account deletion as historical record.
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: agentMessageRole('role').notNull(),
    content: text('content').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('agent_messages_project_created_idx').on(table.projectId, table.createdAt)],
)
