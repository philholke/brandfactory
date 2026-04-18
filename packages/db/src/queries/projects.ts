import type { BrandId, Project, ProjectId } from '@brandfactory/shared'
import { eq } from 'drizzle-orm'
import { db } from '../client'
import { rowToProject } from '../mappers'
import { projects } from '../schema'

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
