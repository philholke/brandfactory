import type {
  Brand,
  BrandGuidelineSection,
  BrandId,
  GuidelineSectionCreatedBy,
  ProseMirrorDoc,
  SectionId,
  WorkspaceId,
} from '@brandfactory/shared'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { rowToBrand, rowToGuidelineSection } from '../mappers'
import { brands, guidelineSections } from '../schema'

export async function getBrandById(id: BrandId): Promise<Brand | null> {
  const [row] = await db.select().from(brands).where(eq(brands.id, id))
  return row ? rowToBrand(row) : null
}

export async function listBrandsByWorkspace(workspaceId: WorkspaceId): Promise<Brand[]> {
  const rows = await db.select().from(brands).where(eq(brands.workspaceId, workspaceId))
  return rows.map(rowToBrand)
}

export async function createBrand(input: {
  workspaceId: WorkspaceId
  name: string
  description?: string | null
}): Promise<Brand> {
  const [row] = await db
    .insert(brands)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning()
  if (!row) throw new Error('createBrand returned no row')
  return rowToBrand(row)
}

export async function listSectionsByBrand(brandId: BrandId): Promise<BrandGuidelineSection[]> {
  const rows = await db
    .select()
    .from(guidelineSections)
    .where(eq(guidelineSections.brandId, brandId))
    .orderBy(guidelineSections.priority)
  return rows.map(rowToGuidelineSection)
}

// Upsert semantics: if `id` is supplied, update that section; otherwise
// insert a new one. No business rules — the caller owns ownership checks
// and priority allocation.
export async function upsertSection(input: {
  id?: SectionId
  brandId: BrandId
  label: string
  body: ProseMirrorDoc
  priority: number
  createdBy: GuidelineSectionCreatedBy
}): Promise<BrandGuidelineSection> {
  if (input.id) {
    const [row] = await db
      .update(guidelineSections)
      .set({
        label: input.label,
        body: input.body,
        priority: input.priority,
        createdBy: input.createdBy,
        updatedAt: sql`now()`,
      })
      .where(and(eq(guidelineSections.id, input.id), eq(guidelineSections.brandId, input.brandId)))
      .returning()
    if (!row) throw new Error(`Section ${input.id} not found in brand ${input.brandId}`)
    return rowToGuidelineSection(row)
  }

  const [row] = await db
    .insert(guidelineSections)
    .values({
      brandId: input.brandId,
      label: input.label,
      body: input.body,
      priority: input.priority,
      createdBy: input.createdBy,
    })
    .returning()
  if (!row) throw new Error('upsertSection insert returned no row')
  return rowToGuidelineSection(row)
}

export async function reorderSections(
  brandId: BrandId,
  updates: Array<{ id: SectionId; priority: number }>,
): Promise<BrandGuidelineSection[]> {
  return db.transaction(async (tx) => {
    for (const { id, priority } of updates) {
      const result = await tx
        .update(guidelineSections)
        .set({ priority, updatedAt: sql`now()` })
        .where(and(eq(guidelineSections.id, id), eq(guidelineSections.brandId, brandId)))
        .returning({ id: guidelineSections.id })
      if (result.length === 0) {
        throw new Error(`Section ${id} not found in brand ${brandId}`)
      }
    }
    const rows = await tx
      .select()
      .from(guidelineSections)
      .where(eq(guidelineSections.brandId, brandId))
      .orderBy(guidelineSections.priority)
    return rows.map(rowToGuidelineSection)
  })
}
