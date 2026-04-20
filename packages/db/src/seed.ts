/**
 * Idempotent dev seed. Produces the minimum fixture a contributor needs to
 * reach a working `/login` and a populated split-screen on first boot:
 *
 *   - one user        (demo@brandfactory.local — id is the dev bearer token)
 *   - one workspace   ("Demo Workspace")
 *   - one brand       ("Acme Coffee") with three seed guideline sections
 *   - one freeform project + canvas attached to that brand
 *
 * Deterministic ids (hard-coded UUIDs) so reruns stay stable and the
 * printed dev token never changes between seeds. `ON CONFLICT DO NOTHING`
 * on every insert; the function is safe to run repeatedly.
 *
 * Printed token = the user UUID. The `local` auth adapter already accepts
 * any UUID that exists in `users` as a bearer; no new token format.
 */

import type { ProseMirrorDoc } from '@brandfactory/shared'
import { sql } from 'drizzle-orm'
import { db, pool } from './client'
import { brands, canvases, guidelineSections, projects, users, workspaces } from './schema'

const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001'
const DEMO_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const DEMO_BRAND_ID = '00000000-0000-4000-8000-000000000003'
const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000004'
const DEMO_CANVAS_ID = '00000000-0000-4000-8000-000000000005'

const DEMO_USER_EMAIL = 'demo@brandfactory.local'
const DEMO_WORKSPACE_NAME = 'Demo Workspace'
const DEMO_BRAND_NAME = 'Acme Coffee'
const DEMO_PROJECT_NAME = 'First brainstorm'

function para(text: string): ProseMirrorDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

interface SeedSection {
  id: string
  label: string
  body: ProseMirrorDoc
  priority: number
}

const SECTIONS: SeedSection[] = [
  {
    id: '00000000-0000-4000-8000-00000000000a',
    label: 'Voice',
    body: para('Warm, confident, a little playful. Sounds like a regular at the corner café.'),
    priority: 1000,
  },
  {
    id: '00000000-0000-4000-8000-00000000000b',
    label: 'Audience',
    body: para('Curious urban professionals who care about provenance as much as caffeine.'),
    priority: 2000,
  },
  {
    id: '00000000-0000-4000-8000-00000000000c',
    label: 'Values',
    body: para(
      'Craft, transparency, zero pretension. Nothing is overhyped; quality speaks for itself.',
    ),
    priority: 3000,
  },
]

export interface SeedResult {
  userId: string
  workspaceId: string
  brandId: string
  projectId: string
}

export async function seed(): Promise<SeedResult> {
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: DEMO_USER_ID, email: DEMO_USER_EMAIL, displayName: 'Demo User' })
      .onConflictDoNothing({ target: users.id })

    await tx
      .insert(workspaces)
      .values({ id: DEMO_WORKSPACE_ID, name: DEMO_WORKSPACE_NAME, ownerUserId: DEMO_USER_ID })
      .onConflictDoNothing({ target: workspaces.id })

    await tx
      .insert(brands)
      .values({
        id: DEMO_BRAND_ID,
        workspaceId: DEMO_WORKSPACE_ID,
        name: DEMO_BRAND_NAME,
        description: 'Small-batch roaster, three shops, one mission: the perfect morning.',
      })
      .onConflictDoNothing({ target: brands.id })

    for (const section of SECTIONS) {
      await tx
        .insert(guidelineSections)
        .values({
          id: section.id,
          brandId: DEMO_BRAND_ID,
          label: section.label,
          body: section.body,
          priority: section.priority,
          createdBy: 'user',
        })
        .onConflictDoNothing({ target: guidelineSections.id })
    }

    await tx
      .insert(projects)
      .values({
        id: DEMO_PROJECT_ID,
        brandId: DEMO_BRAND_ID,
        kind: 'freeform',
        name: DEMO_PROJECT_NAME,
      })
      .onConflictDoNothing({ target: projects.id })

    await tx
      .insert(canvases)
      .values({ id: DEMO_CANVAS_ID, projectId: DEMO_PROJECT_ID })
      .onConflictDoNothing({ target: canvases.id })
  })

  return {
    userId: DEMO_USER_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    brandId: DEMO_BRAND_ID,
    projectId: DEMO_PROJECT_ID,
  }
}

async function main() {
  const result = await seed()
  // `sql.raw` would be wrong here — we just want a no-op round-trip to
  // confirm the pool is live before printing. `select 1` keeps output tidy.
  await db.execute(sql`select 1`)
  console.log('seed: OK')
  console.log(`  user        ${result.userId}  (${DEMO_USER_EMAIL})`)
  console.log(`  workspace   ${result.workspaceId}  (${DEMO_WORKSPACE_NAME})`)
  console.log(`  brand       ${result.brandId}  (${DEMO_BRAND_NAME})`)
  console.log(`  project     ${result.projectId}  (${DEMO_PROJECT_NAME})`)
  console.log('')
  console.log('dev token (paste into /login):')
  console.log(`  ${result.userId}`)
}

// Only run `main` when executed directly (`tsx src/seed.ts`); the seed
// function is importable without side effects for tests.
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  /seed\.[cm]?[jt]s$/.test(process.argv[1])

if (invokedDirectly) {
  main()
    .catch((err: unknown) => {
      console.error('seed: failed')
      console.error(err)
      process.exitCode = 1
    })
    .finally(async () => {
      await pool.end()
    })
}
