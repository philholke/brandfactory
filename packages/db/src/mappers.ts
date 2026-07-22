import {
  ProseMirrorDocSchema,
  type AgentMessage,
  type Brand,
  type BrandGuidelineSection,
  type BrandId,
  type BrandSummary,
  type Canvas,
  type CanvasBlock,
  type CanvasBlockId,
  type CanvasId,
  type ProjectId,
  type ProjectSummary,
  type ProseMirrorDoc,
  type SectionId,
  type UserId,
  type Workspace,
  type WorkspaceId,
} from '@brandfactory/shared'
import type {
  agentMessages,
  brands,
  canvasBlocks,
  canvases,
  guidelineSections,
  projects,
  workspaces,
} from './schema'

type WorkspaceRow = typeof workspaces.$inferSelect
type BrandRow = typeof brands.$inferSelect
type GuidelineSectionRow = typeof guidelineSections.$inferSelect
type ProjectRow = typeof projects.$inferSelect
type CanvasRow = typeof canvases.$inferSelect
type CanvasBlockRow = typeof canvasBlocks.$inferSelect
type AgentMessageRow = typeof agentMessages.$inferSelect

// Parse JSON columns at the trust boundary on read. Writes are gated by
// zod at route boundaries, but a corrupted row (bad migration, direct DB
// edit, historical data) would otherwise propagate silently into prompt
// assembly, canvas-op fan-out, or the wire. A bad doc here is a
// data-integrity bug worth failing loud on.
function parseProseMirrorBody(body: unknown, blockOrSectionId: string): ProseMirrorDoc {
  const result = ProseMirrorDocSchema.safeParse(body)
  if (!result.success) {
    throw new Error(`Row ${blockOrSectionId} has malformed ProseMirror body`)
  }
  return result.data
}

// Timestamps do NOT arrive as ISO 8601. Every timestamp column is declared
// `mode: 'string'`, and drizzle's string mode passes the driver value through
// verbatim — so what lands here is Postgres' own text format,
// `2026-07-22 07:57:59.635905+00` (space separator, `+00` offset, microseconds).
// Every wire schema in `@brandfactory/shared` declares these as
// `z.iso.datetime()`, so the published contract disagreed with reality.
//
// It went unnoticed because no route parses its own response and V8's
// `new Date()` accepts the Postgres format, so the frontend worked. Anything
// stricter — a generated client, a non-JS consumer, or `z.iso.datetime()` at a
// trust boundary — breaks on it.
//
// This has to happen here, not at the driver: registering a `pg` type parser
// is ineffective because drizzle supplies its own `types.getTypeParser` per
// query and that override wins. Mappers are already this package's read-side
// trust boundary (see `parseProseMirrorBody`), so normalisation belongs here.
//
// Sub-millisecond precision is dropped — inherent to ISO-8601-with-ms, and
// already true of any value that round-tripped through a JS `Date`.
function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

// Nullable variant for `pinnedAt` / `deletedAt`.
function toIsoTimestampOrNull(value: string | Date | null): string | null {
  return value === null ? null : toIsoTimestamp(value)
}

export function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    name: row.name,
    ownerUserId: row.ownerUserId as UserId,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

export function rowToBrand(row: BrandRow): Brand {
  return {
    id: row.id as BrandId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    description: row.description,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

// `section_count` / `project_count` come from `count(*)::int`. The cast
// matters: bare `count()` is bigint and node-pg returns it as a string,
// which fails BrandSummarySchema at the route boundary.
export function rowToBrandSummary(
  row: BrandRow & { sectionCount: number; projectCount: number },
): BrandSummary {
  return {
    ...rowToBrand(row),
    sectionCount: row.sectionCount,
    projectCount: row.projectCount,
  }
}

export function rowToProjectSummary(
  row: ProjectRow & { brandName: string; lastActivityAt: string | Date },
): ProjectSummary {
  return {
    ...rowToProject(row),
    brandName: row.brandName,
    lastActivityAt: toIsoTimestamp(row.lastActivityAt),
  }
}

export function rowToGuidelineSection(row: GuidelineSectionRow): BrandGuidelineSection {
  return {
    id: row.id as SectionId,
    brandId: row.brandId as BrandId,
    label: row.label,
    body: parseProseMirrorBody(row.body, row.id),
    priority: row.priority,
    createdBy: row.createdBy,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

export function rowToCanvas(row: CanvasRow): Canvas {
  return {
    id: row.id as CanvasId,
    projectId: row.projectId as ProjectId,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
}

export function rowToProject(row: ProjectRow) {
  const base = {
    id: row.id as ProjectId,
    brandId: row.brandId as BrandId,
    name: row.name,
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
  if (row.kind === 'freeform') {
    return { ...base, kind: 'freeform' as const }
  }
  // `template_id` is enforced non-null by the app layer for standardized
  // projects; treat a null here as a data-integrity bug rather than a
  // silent fallback.
  if (!row.templateId) {
    throw new Error(`Standardized project ${row.id} missing templateId`)
  }
  return { ...base, kind: 'standardized' as const, templateId: row.templateId }
}

// `content` is plain text (no zod parse needed); the AgentMessage wire type
// doesn't carry `createdAt` so we drop it here — callers that need the
// timestamp read the row directly.
export function rowToAgentMessage(row: AgentMessageRow): AgentMessage {
  return {
    kind: 'message',
    id: row.id,
    role: row.role,
    content: row.content,
  }
}

// Kind-specific columns are nullable at the DB level because one wide table
// stores all three variants. The app layer enforces that required per-kind
// fields are present on insert; missing values here signal data-integrity
// bugs, not a normal state to silently fall back on.
export function rowToCanvasBlock(row: CanvasBlockRow): CanvasBlock {
  const base = {
    id: row.id as CanvasBlockId,
    canvasId: row.canvasId as CanvasId,
    position: row.position,
    isPinned: row.isPinned,
    pinnedAt: toIsoTimestampOrNull(row.pinnedAt),
    createdBy: row.createdBy,
    deletedAt: toIsoTimestampOrNull(row.deletedAt),
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt),
  }
  switch (row.kind) {
    case 'text':
      return { ...base, kind: 'text', body: parseProseMirrorBody(row.body, row.id) }
    case 'image': {
      if (!row.blobKey) throw new Error(`Image block ${row.id} missing blobKey`)
      return {
        ...base,
        kind: 'image',
        blobKey: row.blobKey,
        ...(row.alt !== null ? { alt: row.alt } : {}),
        ...(row.width !== null ? { width: row.width } : {}),
        ...(row.height !== null ? { height: row.height } : {}),
      }
    }
    case 'file': {
      if (!row.blobKey) throw new Error(`File block ${row.id} missing blobKey`)
      if (!row.filename) throw new Error(`File block ${row.id} missing filename`)
      if (!row.mime) throw new Error(`File block ${row.id} missing mime`)
      return {
        ...base,
        kind: 'file',
        blobKey: row.blobKey,
        filename: row.filename,
        mime: row.mime,
      }
    }
  }
}
