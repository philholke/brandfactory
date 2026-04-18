import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { canvases } from './canvases'

export const canvasBlockKind = pgEnum('canvas_block_kind', ['text', 'image', 'file'])
export const canvasBlockCreatedBy = pgEnum('canvas_block_created_by', ['user', 'agent'])

// One wide table with nullable per-kind columns, rather than table-per-kind.
// Matches the shared discriminated union, keeps event payloads simple, and
// avoids a join on every canvas read.
export const canvasBlocks = pgTable(
  'canvas_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canvasId: uuid('canvas_id')
      .notNull()
      .references(() => canvases.id, { onDelete: 'cascade' }),
    kind: canvasBlockKind('kind').notNull(),
    // Sparse ints — rebalance on collision (renumber 1..N). Lives in
    // queries/canvas.ts.
    position: integer('position').notNull(),
    isPinned: boolean('is_pinned').notNull().default(false),
    pinnedAt: timestamp('pinned_at', { withTimezone: true, mode: 'string' }),
    createdBy: canvasBlockCreatedBy('created_by').notNull(),
    // Soft-delete — discarded ideas hide, they don't vanish.
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
    // Kind-specific columns, all nullable at the DB level. The app layer
    // validates them against the shared discriminated union on write.
    body: jsonb('body'),
    blobKey: text('blob_key'),
    alt: text('alt'),
    width: integer('width'),
    height: integer('height'),
    filename: text('filename'),
    mime: text('mime'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('canvas_blocks_canvas_position_active_idx')
      .on(table.canvasId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
    index('canvas_blocks_canvas_pinned_active_idx')
      .on(table.canvasId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isPinned} = true`),
    index('canvas_blocks_canvas_deleted_idx').on(table.canvasId, table.deletedAt),
  ],
)
