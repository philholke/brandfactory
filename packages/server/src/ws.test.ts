import type { UserId } from '@brandfactory/shared'
import { describe, expect, it } from 'vitest'
import { authorizeChannel } from './ws'
import { createFakeDb } from './test-helpers'

async function seed() {
  const { db } = createFakeDb()
  const owner = 'user-owner' as UserId
  const ws = await db.createWorkspace({ name: 'w', ownerUserId: owner })
  const br = await db.createBrand({ workspaceId: ws.id, name: 'b' })
  const { project: pr } = await db.createProjectWithCanvas({
    kind: 'freeform',
    brandId: br.id,
    name: 'p',
  })
  return { db, owner, ws, br, pr }
}

describe('authorizeChannel', () => {
  it('allows workspace: for the owner', async () => {
    const { db, owner, ws } = await seed()
    expect(await authorizeChannel(owner, `workspace:${ws.id}`, db)).toBe(true)
  })

  it('allows brand: for the owner', async () => {
    const { db, owner, br } = await seed()
    expect(await authorizeChannel(owner, `brand:${br.id}`, db)).toBe(true)
  })

  it('allows project: for the owner', async () => {
    const { db, owner, pr } = await seed()
    expect(await authorizeChannel(owner, `project:${pr.id}`, db)).toBe(true)
  })

  it('denies the wrong user on an existing channel', async () => {
    const { db, pr } = await seed()
    expect(await authorizeChannel('stranger', `project:${pr.id}`, db)).toBe(false)
  })

  it('denies a missing aggregate', async () => {
    const { db, owner } = await seed()
    expect(await authorizeChannel(owner, 'project:ghost', db)).toBe(false)
  })

  it('denies unknown prefixes', async () => {
    const { db, owner } = await seed()
    expect(await authorizeChannel(owner, 'other:x', db)).toBe(false)
  })

  it('denies malformed channels', async () => {
    const { db, owner } = await seed()
    expect(await authorizeChannel(owner, 'no-colon', db)).toBe(false)
    expect(await authorizeChannel(owner, 'project:', db)).toBe(false)
  })
})
