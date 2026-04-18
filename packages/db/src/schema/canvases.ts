import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const canvases = pgTable('canvases', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Unique — one canvas per project in V1. Drop the uniqueness if the
  // product ever needs multiple canvases per project.
  projectId: uuid('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})
