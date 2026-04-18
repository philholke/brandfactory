import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { brands } from './brands'

export const guidelineSectionCreatedBy = pgEnum('guideline_section_created_by', ['user', 'agent'])

export const guidelineSections = pgTable(
  'guideline_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    body: jsonb('body').notNull(),
    priority: integer('priority').notNull(),
    createdBy: guidelineSectionCreatedBy('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('guideline_sections_brand_id_priority_idx').on(table.brandId, table.priority)],
)
