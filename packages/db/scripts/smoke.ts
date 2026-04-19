/**
 * End-to-end smoke check for @brandfactory/db against a real Postgres.
 *
 * Prerequisites:
 *   1. docker compose -f docker/compose.yaml up -d postgres
 *   2. DATABASE_URL exported (or prefixed on the command)
 *   3. pnpm --filter @brandfactory/db db:generate && db:migrate
 *
 * Then: pnpm --filter @brandfactory/db smoke
 *
 * Exits 0 on success, non-zero on any assertion failure or thrown error.
 * Idempotent re-runs aren't a goal — the canonical reset is
 * `docker compose -f docker/compose.yaml down -v`.
 */

import {
  appendCanvasEvent,
  createBlock,
  createBrand,
  createCanvas,
  createProject,
  createUser,
  createWorkspace,
  getShortlistView,
  getWorkspaceSettings,
  listBlockEvents,
  pool,
  setPinned,
  softDeleteBlock,
  upsertSection,
  upsertWorkspaceSettings,
} from '../src'
import type {
  BrandId,
  CanvasBlockId,
  CanvasId,
  ProjectId,
  UserId,
  WorkspaceId,
} from '@brandfactory/shared'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`smoke: assertion failed — ${msg}`)
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`smoke: ${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`)
  }
}

async function main() {
  console.log('smoke: starting')

  // User + workspace + brand
  const user = await createUser({ email: `smoke-${Date.now()}@example.com` })
  console.log(`  user       ${user.id}`)

  const workspace = await createWorkspace({
    name: 'Smoke Workspace',
    ownerUserId: user.id as UserId,
  })
  console.log(`  workspace  ${workspace.id}`)

  const brand = await createBrand({
    workspaceId: workspace.id as WorkspaceId,
    name: 'Smoke Brand',
    description: 'Throwaway brand for the smoke check.',
  })
  console.log(`  brand      ${brand.id}`)

  // Two guideline sections
  const voiceSection = await upsertSection({
    brandId: brand.id as BrandId,
    label: 'Voice & tone',
    body: { type: 'doc', content: [] },
    priority: 1,
    createdBy: 'user',
  })
  const audienceSection = await upsertSection({
    brandId: brand.id as BrandId,
    label: 'Target audience',
    body: { type: 'doc', content: [] },
    priority: 2,
    createdBy: 'user',
  })
  console.log(`  sections   ${voiceSection.id}, ${audienceSection.id}`)

  // Freeform project + canvas
  const project = await createProject({
    kind: 'freeform',
    brandId: brand.id as BrandId,
    name: 'Smoke Project',
  })
  console.log(`  project    ${project.id}`)

  const canvas = await createCanvas(project.id as ProjectId)
  const canvasId = canvas.id as CanvasId
  console.log(`  canvas     ${canvasId}`)

  // Text block, pinned (setPinned after create so pinnedAt is stamped)
  const block = await createBlock({
    kind: 'text',
    canvasId,
    position: 1,
    createdBy: 'user',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    },
  })
  const pinnedBlock = await setPinned(block.id as CanvasBlockId, true)
  assert(pinnedBlock.isPinned, 'block should be pinned after setPinned(true)')
  assert(pinnedBlock.pinnedAt, 'pinnedAt should be stamped')
  console.log(`  block      ${block.id} (pinned)`)

  // Event log: add_block, pin
  await appendCanvasEvent({
    canvasId,
    blockId: block.id as CanvasBlockId,
    op: 'add_block',
    actor: 'user',
    userId: user.id as UserId,
    payload: { block: { id: block.id, kind: 'text' } },
  })
  await appendCanvasEvent({
    canvasId,
    blockId: block.id as CanvasBlockId,
    op: 'pin',
    actor: 'user',
    userId: user.id as UserId,
    payload: {},
  })
  console.log('  events     add_block, pin')

  // Shortlist: expect one block
  const shortlistBefore = await getShortlistView(project.id as ProjectId)
  assertEqual(
    shortlistBefore.blockIds.length,
    1,
    'shortlist should contain exactly one block before soft-delete',
  )
  assertEqual(shortlistBefore.blockIds[0], block.id, 'shortlist block id should match')
  console.log(`  shortlist  [${shortlistBefore.blockIds.join(', ')}]`)

  // Soft-delete + remove_block event
  await softDeleteBlock(block.id as CanvasBlockId)
  await appendCanvasEvent({
    canvasId,
    blockId: block.id as CanvasBlockId,
    op: 'remove_block',
    actor: 'user',
    userId: user.id as UserId,
    payload: {},
  })
  console.log('  events     remove_block')

  // Shortlist: expect empty
  const shortlistAfter = await getShortlistView(project.id as ProjectId)
  assertEqual(shortlistAfter.blockIds.length, 0, 'shortlist should be empty after soft-delete')
  console.log(`  shortlist  []`)

  // Workspace settings: null before write, then upsert + read-back
  const settingsBefore = await getWorkspaceSettings(workspace.id as WorkspaceId)
  assertEqual(settingsBefore, null, 'settings should be null before upsert')
  const settingsAfter = await upsertWorkspaceSettings({
    workspaceId: workspace.id as WorkspaceId,
    llmProviderId: 'anthropic',
    llmModel: 'claude-sonnet-4-6',
  })
  assertEqual(settingsAfter.llmProviderId, 'anthropic', 'settings provider should persist')
  assertEqual(settingsAfter.llmModel, 'claude-sonnet-4-6', 'settings model should persist')
  const settingsUpdated = await upsertWorkspaceSettings({
    workspaceId: workspace.id as WorkspaceId,
    llmProviderId: 'openai',
    llmModel: 'gpt-4o-mini',
  })
  assertEqual(settingsUpdated.llmProviderId, 'openai', 'settings upsert should replace provider')
  console.log(`  settings   ${settingsUpdated.llmProviderId}/${settingsUpdated.llmModel}`)

  // listBlockEvents: [add_block, pin, remove_block] in order
  const blockEvents = await listBlockEvents(block.id as CanvasBlockId)
  assertEqual(blockEvents.length, 3, 'expected three block events')
  assertEqual(blockEvents[0]?.op, 'add_block', 'first event should be add_block')
  assertEqual(blockEvents[1]?.op, 'pin', 'second event should be pin')
  assertEqual(blockEvents[2]?.op, 'remove_block', 'third event should be remove_block')
  console.log(`  history    ${blockEvents.map((e) => e.op).join(' → ')}`)

  console.log('smoke: OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
