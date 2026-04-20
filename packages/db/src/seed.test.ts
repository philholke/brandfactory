import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, pool } from './client'
import { brands, guidelineSections, projects, users, workspaces } from './schema'
import { seed } from './seed'

// Live-DB test — only runs when DATABASE_URL is set (dev compose or CI's
// `postgres:16` service). Skipped locally for contributors who haven't set
// up Postgres yet; CI's workflow exports `DATABASE_URL` before `pnpm test`.
const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('seed()', () => {
  afterAll(async () => {
    await pool.end()
  })

  it('is idempotent — running twice yields one row per seeded aggregate', async () => {
    const first = await seed()
    const second = await seed()

    // Deterministic ids — the two runs must return identical references.
    expect(second).toEqual(first)

    const [userRows, wsRows, brandRows, projRows, sectionRows] = await Promise.all([
      db.select().from(users).where(eq(users.id, first.userId)),
      db.select().from(workspaces).where(eq(workspaces.id, first.workspaceId)),
      db.select().from(brands).where(eq(brands.id, first.brandId)),
      db.select().from(projects).where(eq(projects.id, first.projectId)),
      db.select().from(guidelineSections).where(eq(guidelineSections.brandId, first.brandId)),
    ])

    expect(userRows).toHaveLength(1)
    expect(wsRows).toHaveLength(1)
    expect(brandRows).toHaveLength(1)
    expect(projRows).toHaveLength(1)
    expect(sectionRows).toHaveLength(3)
  })
})
