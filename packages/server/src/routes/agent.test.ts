import { describe, expect, it, vi } from 'vitest'
import type { LLMProvider } from '@brandfactory/adapter-llm'
import type { RealtimeBus, RealtimeEvent } from '@brandfactory/adapter-realtime'
import { fakeModel, fakeProvider, makeAsyncModel } from '../agent/test-fakes'
import { createTestApp, type TestHarness } from '../test-helpers'

const TOKEN = 't-agent'
const USER_ID = 'u-agent'

interface SeededHarness extends TestHarness {
  brandId: string
  projectId: string
  canvasId: string
}

async function seedProject(opts?: {
  llm?: LLMProvider
  realtime?: RealtimeBus
}): Promise<SeededHarness> {
  const harness = createTestApp({
    users: [{ id: USER_ID, token: TOKEN }],
    ...(opts?.llm ? { llm: opts.llm } : {}),
    ...(opts?.realtime ? { realtime: opts.realtime } : {}),
  })
  const { app } = harness
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
  const ws = (await (
    await app.request('/workspaces', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'W' }),
    })
  ).json()) as { id: string }
  const br = (await (
    await app.request(`/workspaces/${ws.id}/brands`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'B' }),
    })
  ).json()) as { id: string }
  const pr = (await (
    await app.request(`/brands/${br.id}/projects`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ kind: 'freeform', name: 'P' }),
    })
  ).json()) as { id: string }
  const canvas = [...harness.state.canvases.values()].find((c) => c.projectId === pr.id)!
  return { ...harness, brandId: br.id, projectId: pr.id, canvasId: canvas.id }
}

async function readSse(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  return out
}

function captureBus(): {
  bus: RealtimeBus
  published: Array<{ channel: string; event: RealtimeEvent }>
} {
  const published: Array<{ channel: string; event: RealtimeEvent }> = []
  return {
    published,
    bus: {
      async publish(channel, event) {
        published.push({ channel, event })
      },
      subscribe: () => () => {},
    },
  }
}

describe('POST /projects/:id/agent', () => {
  it('401s when no auth token is presented', async () => {
    const { app, projectId } = await seedProject()
    const res = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { content: 'hi' } }),
    })
    expect(res.status).toBe(401)
  })

  it('404s when the project does not exist', async () => {
    const { app } = await seedProject({
      llm: fakeProvider(fakeModel([])),
    })
    const res = await app.request(`/projects/00000000-0000-4000-8000-000000000000/agent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { content: 'hi' } }),
    })
    expect(res.status).toBe(404)
  })

  it('happy path: streams text deltas, persists user + assistant rows', async () => {
    const llm = fakeProvider(
      fakeModel([
        { type: 'text-delta', textDelta: 'Hello ' },
        { type: 'text-delta', textDelta: 'world.' },
        { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
      ]),
    )
    const { app, state, projectId } = await seedProject({ llm })
    const res = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { content: 'hi' } }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const body = await readSse(res.body!)
    expect(body).toContain('event: message\n')
    expect(body).toContain('"content":"Hello world."')
    expect(body).toContain('event: done\ndata: {}\n\n')

    const messages = state.agentMessages
      .filter((r) => r.projectId === projectId)
      .map((r) => ({ role: r.message.role, content: r.message.content }))
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello world.' },
    ])
  })

  it('happy path with add_canvas_block: persists block, fans out canvas-op', async () => {
    const args = JSON.stringify({
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
      },
      position: 0,
    })
    const llm = fakeProvider(
      fakeModel([
        {
          type: 'tool-call',
          toolCallType: 'function',
          toolCallId: 'call_1',
          toolName: 'add_canvas_block',
          args,
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { promptTokens: 1, completionTokens: 1 },
        },
      ]),
    )
    const { bus, published } = captureBus()
    const { app, state, projectId, canvasId } = await seedProject({ llm, realtime: bus })
    const res = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { content: 'add one' } }),
    })
    expect(res.status).toBe(200)
    const body = await readSse(res.body!)
    expect(body).toContain('event: tool-call\n')
    expect(body).toContain('event: canvas-op\n')

    const blocks = [...state.canvasBlocks.values()].filter((b) => b.canvasId === canvasId)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.createdBy).toBe('agent')
    expect(blocks[0]!.kind).toBe('text')

    expect(state.canvasEvents).toHaveLength(1)
    expect(state.canvasEvents[0]!.op).toBe('add_block')
    expect(state.canvasEvents[0]!.actor).toBe('agent')

    const canvasOps = published.filter((p) => p.event.kind === 'canvas-op')
    expect(canvasOps).toHaveLength(1)
    expect(canvasOps[0]!.channel).toBe(`project:${projectId}`)
  })

  it('returns 409 AGENT_BUSY when a second turn races the same project', async () => {
    let release: () => void = () => {}
    const ready = new Promise<void>((r) => {
      release = r
    })
    const llm = fakeProvider(
      makeAsyncModel(async function* () {
        yield { type: 'text-delta', textDelta: 'streaming…' }
        await ready
        yield {
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
        }
      }),
    )
    const { app, projectId } = await seedProject({ llm })
    const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

    const first = app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ message: { content: 'first' } }),
    })
    // Yield the loop so the first request starts streaming and acquires the slot.
    await new Promise((r) => setTimeout(r, 10))

    const second = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ message: { content: 'second' } }),
    })
    expect(second.status).toBe(409)
    const errBody = (await second.json()) as { code: string }
    expect(errBody.code).toBe('AGENT_BUSY')

    release()
    const firstRes = await first
    await readSse(firstRes.body!)

    // Slot is released after the first stream closes; a follow-up succeeds.
    const third = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ message: { content: 'third' } }),
    })
    expect(third.status).toBe(200)
    await readSse(third.body!)
  })

  it('emits SSE error frame on stream failure and persists no assistant row', async () => {
    const llm = fakeProvider(fakeModel([{ type: 'error', error: new Error('upstream kaput') }]))
    const { app, state, projectId } = await seedProject({ llm })
    const res = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { content: 'fail me' } }),
    })
    expect(res.status).toBe(200)
    const body = await readSse(res.body!)
    expect(body).toContain('event: error\n')
    expect(body).toContain('upstream kaput')

    const rolesPersisted = state.agentMessages
      .filter((r) => r.projectId === projectId)
      .map((r) => r.message.role)
    expect(rolesPersisted).toEqual(['user'])
  })

  it('falls back to env LLM settings when workspace has no override', async () => {
    const getModel = vi.fn(() =>
      fakeModel([
        { type: 'text-delta', textDelta: 'ok' },
        { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
      ]),
    )
    const llm: LLMProvider = { getModel }
    const { app, projectId } = await seedProject({ llm })
    const res = await app.request(`/projects/${projectId}/agent`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { content: 'hi' } }),
    })
    expect(res.status).toBe(200)
    await readSse(res.body!)
    expect(getModel).toHaveBeenCalledTimes(1)
    expect(getModel).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })
  })
})
