import { desc, sql } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { canvases } from './canvases'
import { users } from './users'

export const canvasEventOp = pgEnum('canvas_event_op', [
  'add_block',
  'update_block',
  'remove_block',
  'restore_block',
  'pin',
  'unpin',
])

export const canvasEventActor = pgEnum('canvas_event_actor', ['user', 'agent'])

// Append-only log — no `updated_at`. `block_id` is intentionally not an FK
// so the log survives a future hard-delete (e.g. GDPR erasure). Re-evaluate
// in Phase 9 if soft-delete becomes a permanent guarantee.
export const canvasEvents = pgTable(
  'canvas_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    canvasId: uuid('canvas_id')
      .notNull()
      .references(() => canvases.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id'),
    op: canvasEventOp('op').notNull(),
    actor: canvasEventActor('actor').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    // Op-specific payload. Full block snapshot on add, diff on update,
    // empty object on pin/unpin/remove/restore. Validated at the app layer
    // against CanvasOpSchema / PinOpSchema from @brandfactory/shared.
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('canvas_events_canvas_timeline_idx').on(table.canvasId, desc(table.createdAt)),
    index('canvas_events_block_timeline_idx')
      .on(table.blockId, desc(table.createdAt))
      .where(sql`${table.blockId} IS NOT NULL`),
  ],
)
