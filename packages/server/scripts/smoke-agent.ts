/**
 * End-to-end smoke check for `POST /projects/:id/agent`.
 *
 * Boots the real Hono app against dev Postgres and a real LLM provider,
 * seeds a workspace/brand/project, fires the agent route, and parses the
 * SSE stream. Then re-reads the project to confirm canvas mutations
 * persisted.
 *
 * Prerequisites:
 *   1. docker compose -f docker/compose.yaml up -d postgres
 *   2. DATABASE_URL exported, OPENROUTER_API_KEY set
 *   3. pnpm --filter @brandfactory/db db:migrate (latest schema)
 *
 * Then: pnpm --filter @brandfactory/server smoke-agent
 *
 * Gated on OPENROUTER_API_KEY + DATABASE_URL — missing keys exit 1 with a
 * clear message rather than failing mid-stream.
 */

import { randomUUID } from 'node:crypto'
import {
  appendAgentMessage,
  createBrand,
  createProjectWithCanvas,
  createUser,
  createWorkspace,
  pool,
  upsertSection,
} from '@brandfactory/db'
import type { AgentEvent, BrandId, ProjectId, UserId, WorkspaceId } from '@brandfactory/shared'
import { createAgentConcurrencyGuard } from '../src/agent/concurrency'
import { createApp } from '../src/app'
import { buildAdapters } from '../src/adapters'
import { buildDbDeps } from '../src/db'
import { loadEnv } from '../src/env'
import { createLogger } from '../src/logger'

if (!process.env['OPENROUTER_API_KEY']) {
  console.error('smoke-agent: OPENROUTER_API_KEY is required')
  process.exit(1)
}
if (!process.env['DATABASE_URL']) {
  console.error('smoke-agent: DATABASE_URL is required')
  process.exit(1)
}

async function main(): Promise<void> {
  // Force OpenRouter for a deterministic tool-use baseline (Anthropic's
  // hosted Sonnet via OR is the same model the agent smoke uses).
  process.env['LLM_PROVIDER'] = process.env['LLM_PROVIDER'] ?? 'openrouter'
  process.env['LLM_MODEL'] = process.env['LLM_MODEL'] ?? 'anthropic/claude-3.5-sonnet'
  process.env['AUTH_PROVIDER'] = process.env['AUTH_PROVIDER'] ?? 'local'
  process.env['STORAGE_PROVIDER'] = process.env['STORAGE_PROVIDER'] ?? 'local-disk'
  process.env['REALTIME_PROVIDER'] = process.env['REALTIME_PROVIDER'] ?? 'native-ws'
  process.env['BLOB_LOCAL_DISK_ROOT'] =
    process.env['BLOB_LOCAL_DISK_ROOT'] ?? '/tmp/brandfactory-smoke-blobs'
  process.env['BLOB_SIGNING_SECRET'] = process.env['BLOB_SIGNING_SECRET'] ?? 'smoke-secret'
  process.env['BLOB_PUBLIC_BASE_URL'] =
    process.env['BLOB_PUBLIC_BASE_URL'] ?? 'http://localhost:3001/blobs'

  const env = loadEnv()
  const log = createLogger({ level: env.LOG_LEVEL })
  const adapters = buildAdapters(env)
  const db = buildDbDeps()
  const agentGuard = createAgentConcurrencyGuard()
  const app = createApp({
    env,
    log,
    db,
    auth: adapters.auth,
    storage: adapters.storage,
    realtime: adapters.realtime.bus,
    llm: adapters.llm,
    agentGuard,
  })

  const stamp = Date.now()
  const user = await createUser({ email: `smoke-agent-${stamp}@example.com` })
  console.log(`  user       ${user.id}`)
  const workspace = await createWorkspace({
    name: 'Agent smoke',
    ownerUserId: user.id as UserId,
  })
  const brand = await createBrand({
    workspaceId: workspace.id as WorkspaceId,
    name: 'Northstar Coffee',
    description: 'Specialty roaster, minimalist aesthetic.',
  })
  await upsertSection({
    brandId: brand.id as BrandId,
    label: 'Voice',
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Warm, direct, unpretentious.' }],
        },
      ],
    },
    priority: 10,
    createdBy: 'user',
  })
  const { project } = await createProjectWithCanvas({
    kind: 'freeform',
    brandId: brand.id as BrandId,
    name: 'Tagline ideation',
  })
  console.log(`  project    ${project.id}`)

  // Seed prior turn so we exercise the history-load path.
  await appendAgentMessage({
    projectId: project.id as ProjectId,
    role: 'user',
    content: 'Earlier note: brand is targeting urban 25–40 year olds.',
    userId: user.id as UserId,
  })

  // Local auth verifies a `Bearer <userId>` token in dev.
  const token = `Bearer ${user.id}`
  const requestId = randomUUID()
  const res = await app.request(`/projects/${project.id}/agent`, {
    method: 'POST',
    headers: {
      authorization: token,
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
    body: JSON.stringify({
      message: {
        content:
          'Suggest three tagline ideas for Northstar Coffee. Use add_canvas_block to post each one.',
      },
    }),
  })

  if (res.status !== 200) {
    const body = await res.text()
    console.error(`smoke-agent: route returned ${res.status}: ${body}`)
    process.exit(1)
  }
  console.log(`  status     ${res.status}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let canvasOps = 0
  let messages = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx = buf.indexOf('\n\n')
    while (idx !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      idx = buf.indexOf('\n\n')
      if (frame.startsWith(': ')) continue
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      const payload = dataLine.slice(6)
      if (payload === '{}') continue
      try {
        const event = JSON.parse(payload) as AgentEvent
        if (event.kind === 'message') {
          messages += 1
          process.stdout.write(`[message] ${event.content}\n`)
        } else if (event.kind === 'tool-call') {
          process.stdout.write(`[tool-call ${event.toolName}]\n`)
        } else if (event.kind === 'canvas-op') {
          canvasOps += 1
          process.stdout.write(`[canvas-op ${event.op.op}]\n`)
        } else if (event.kind === 'pin-op') {
          process.stdout.write(`[pin-op ${event.op.op}]\n`)
        }
      } catch {
        // Non-JSON `done` frame already filtered above.
      }
    }
  }

  console.log('---')
  console.log(`  messages    ${messages}`)
  console.log(`  canvas ops  ${canvasOps}`)

  const verify = await app.request(`/projects/${project.id}`, {
    headers: { authorization: token },
  })
  if (verify.status !== 200) {
    console.error(`smoke-agent: GET project returned ${verify.status}`)
    process.exit(1)
  }
  const persisted = (await verify.json()) as { canvas: unknown }
  console.log(`  GET ok     ${persisted.canvas ? 'canvas present' : 'no canvas'}`)

  if (canvasOps === 0) {
    console.warn('smoke-agent: no canvas-op events — model may not have tool-used reliably.')
    process.exit(2)
  }
  console.log('smoke-agent: OK')
}

main()
  .catch((err: unknown) => {
    console.error('smoke-agent: fatal', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
