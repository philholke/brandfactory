import type { BrandId, ProjectId, UserId, WorkspaceId } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { requireBrandAccess, requireProjectAccess, requireWorkspaceAccess } from './authz'
import { ForbiddenError, NotFoundError } from './errors'
import { createFakeDb } from './test-helpers'

async function seed() {
  const { db, state } = createFakeDb()
  const owner = 'user-owner' as UserId
  const workspace = await db.createWorkspace({ name: 'w', ownerUserId: owner })
  const brand = await db.createBrand({ workspaceId: workspace.id, name: 'b' })
  const { project } = await db.createProjectWithCanvas({
    kind: 'freeform',
    brandId: brand.id,
    name: 'p',
  })
  return { db, state, owner, workspace, brand, project }
}

describe('requireWorkspaceAccess', () => {
  it('returns the workspace for the owner', async () => {
    const { db, owner, workspace } = await seed()
    const got = await requireWorkspaceAccess(owner, workspace.id, db)
    expect(got.id).toBe(workspace.id)
  })

  it('throws ForbiddenError for a non-owner', async () => {
    const { db, workspace } = await seed()
    await expect(requireWorkspaceAccess('stranger', workspace.id, db)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('throws NotFoundError for a missing workspace', async () => {
    const { db, owner } = await seed()
    await expect(requireWorkspaceAccess(owner, 'ghost' as WorkspaceId, db)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('requireBrandAccess', () => {
  it('walks brand → workspace for the owner', async () => {
    const { db, owner, brand } = await seed()
    const got = await requireBrandAccess(owner, brand.id, db)
    expect(got.brand.id).toBe(brand.id)
  })

  it('forbids a non-owner on an existing brand', async () => {
    const { db, brand } = await seed()
    await expect(requireBrandAccess('stranger', brand.id, db)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('404s a missing brand', async () => {
    const { db, owner } = await seed()
    await expect(requireBrandAccess(owner, 'ghost' as BrandId, db)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('requireProjectAccess', () => {
  it('walks project → brand → workspace for the owner', async () => {
    const { db, owner, project } = await seed()
    const got = await requireProjectAccess(owner, project.id, db)
    expect(got.project.id).toBe(project.id)
  })

  it('forbids a non-owner', async () => {
    const { db, project } = await seed()
    await expect(requireProjectAccess('stranger', project.id, db)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('404s a missing project', async () => {
    const { db, owner } = await seed()
    await expect(requireProjectAccess(owner, 'ghost' as ProjectId, db)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})
