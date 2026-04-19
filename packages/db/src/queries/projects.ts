import type { BrandId, Canvas, Project, ProjectId } from '@brandfactory/shared'
import { eq } from 'drizzle-orm'
import { db } from '../client'
import { rowToCanvas, rowToProject } from '../mappers'
import { canvases, projects } from '../schema'

export type CreateProjectInput =
  | { kind: 'freeform'; brandId: BrandId; name: string }
  | { kind: 'standardized'; brandId: BrandId; name: string; templateId: string }

export async function getProjectById(id: ProjectId): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id))
  return row ? rowToProject(row) : null
}

export async function listProjectsByBrand(brandId: BrandId): Promise<Project[]> {
  const rows = await db.select().from(projects).where(eq(projects.brandId, brandId))
  return rows.map(rowToProject)
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({
      brandId: input.brandId,
      kind: input.kind,
      name: input.name,
      templateId: input.kind === 'standardized' ? input.templateId : null,
    })
    .returning()
  if (!row) throw new Error('createProject returned no row')
  return rowToProject(row)
}

// Atomic project + canvas creation. Projects carry a 1:1 canvas, so the
// invariant lives in one transaction — half-creating leaves no orphan row
// for Phase 6's agent or the HTTP route to trip over.
export async function createProjectWithCanvas(
  input: CreateProjectInput,
): Promise<{ project: Project; canvas: Canvas }> {
  return db.transaction(async (tx) => {
    const [projectRow] = await tx
      .insert(projects)
      .values({
        brandId: input.brandId,
        kind: input.kind,
        name: input.name,
        templateId: input.kind === 'standardized' ? input.templateId : null,
      })
      .returning()
    if (!projectRow) throw new Error('createProjectWithCanvas: project insert returned no row')
    const [canvasRow] = await tx.insert(canvases).values({ projectId: projectRow.id }).returning()
    if (!canvasRow) throw new Error('createProjectWithCanvas: canvas insert returned no row')
    return { project: rowToProject(projectRow), canvas: rowToCanvas(canvasRow) }
  })
}
