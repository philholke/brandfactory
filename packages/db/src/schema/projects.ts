import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { brands } from './brands'

export const projectKind = pgEnum('project_kind', ['freeform', 'standardized'])

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    kind: projectKind('kind').notNull(),
    // Non-null only when `kind = 'standardized'`. Enforced at the app
    // layer in V1; a CHECK constraint can come later if it proves useful.
    templateId: text('template_id'),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('projects_brand_id_idx').on(table.brandId)],
)
