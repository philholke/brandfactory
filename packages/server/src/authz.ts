import type {
  Brand,
  BrandId,
  Project,
  ProjectId,
  Workspace,
  WorkspaceId,
} from '@brandfactory/shared'
import { ForbiddenError, NotFoundError } from './errors'

// Dependency surface: the narrow slice of `@brandfactory/db`'s query helpers
// we actually call. Keeping the shape explicit lets tests inject fakes
// without importing the real singleton.
export interface AuthzDeps {
  getWorkspaceById: (id: WorkspaceId) => Promise<Workspace | null>
  getBrandById: (id: BrandId) => Promise<Brand | null>
  getProjectById: (id: ProjectId) => Promise<Project | null>
}

export async function requireWorkspaceAccess(
  userId: string,
  workspaceId: WorkspaceId,
  deps: Pick<AuthzDeps, 'getWorkspaceById'>,
): Promise<Workspace> {
  const workspace = await deps.getWorkspaceById(workspaceId)
  if (!workspace) throw new NotFoundError('workspace not found', 'WORKSPACE_NOT_FOUND')
  if (workspace.ownerUserId !== userId) throw new ForbiddenError('not the workspace owner')
  return workspace
}

export async function requireBrandAccess(
  userId: string,
  brandId: BrandId,
  deps: Pick<AuthzDeps, 'getBrandById' | 'getWorkspaceById'>,
): Promise<{ brand: Brand; workspace: Workspace }> {
  const brand = await deps.getBrandById(brandId)
  if (!brand) throw new NotFoundError('brand not found', 'BRAND_NOT_FOUND')
  const workspace = await requireWorkspaceAccess(userId, brand.workspaceId, deps)
  return { brand, workspace }
}

export async function requireProjectAccess(
  userId: string,
  projectId: ProjectId,
  deps: AuthzDeps,
): Promise<{ project: Project; brand: Brand; workspace: Workspace }> {
  const project = await deps.getProjectById(projectId)
  if (!project) throw new NotFoundError('project not found', 'PROJECT_NOT_FOUND')
  const { brand, workspace } = await requireBrandAccess(userId, project.brandId, deps)
  return { project, brand, workspace }
}
