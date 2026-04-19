import {
  ProseMirrorDocSchema,
  type Brand,
  type BrandGuidelineSection,
  type BrandId,
  type Canvas,
  type CanvasBlock,
  type CanvasBlockId,
  type CanvasId,
  type ProjectId,
  type ProseMirrorDoc,
  type SectionId,
  type UserId,
  type Workspace,
  type WorkspaceId,
} from '@brandfactory/shared'
import type {
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

export function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    name: row.name,
    ownerUserId: row.ownerUserId as UserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function rowToBrand(row: BrandRow): Brand {
  return {
    id: row.id as BrandId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function rowToCanvas(row: CanvasRow): Canvas {
  return {
    id: row.id as CanvasId,
    projectId: row.projectId as ProjectId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function rowToProject(row: ProjectRow) {
  const base = {
    id: row.id as ProjectId,
    brandId: row.brandId as BrandId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    pinnedAt: row.pinnedAt,
    createdBy: row.createdBy,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
