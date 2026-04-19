import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@brandfactory/shared'
import { streamResponseToSse } from './sse'
import { silentLogger } from '../test-helpers'

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  return out
}

async function* asyncFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}

const MSG: AgentEvent = {
  kind: 'message',
  id: 'm1',
  role: 'assistant',
  content: 'hi',
}

describe('streamResponseToSse', () => {
  it('frames each event then emits trailing done', async () => {
    const res = streamResponseToSse({
      events: asyncFrom<AgentEvent>([MSG]),
      signal: new AbortController().signal,
      log: silentLogger(),
    })
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const body = await readAll(res)
    expect(body).toContain('event: message\n')
    expect(body).toContain(`data: ${JSON.stringify(MSG)}\n\n`)
    expect(body).toContain('event: done\ndata: {}\n\n')
  })

  it('invokes onEvent for each frame and onClose at end', async () => {
    const onEvent = vi.fn()
    const onClose = vi.fn()
    const second: AgentEvent = {
      kind: 'message',
      id: 'm2',
      role: 'assistant',
      content: 'two',
    }
    const res = streamResponseToSse({
      events: asyncFrom<AgentEvent>([MSG, second]),
      signal: new AbortController().signal,
      log: silentLogger(),
      onEvent,
      onClose,
    })
    await readAll(res)
    expect(onEvent).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('emits an error frame followed by done when the iterable throws', async () => {
    async function* failing(): AsyncIterable<AgentEvent> {
      yield MSG
      throw new Error('upstream kaput')
    }
    const onClose = vi.fn()
    const res = streamResponseToSse({
      events: failing(),
      signal: new AbortController().signal,
      log: silentLogger(),
      onClose,
    })
    const body = await readAll(res)
    expect(body).toContain('event: message\n')
    expect(body).toContain('event: error\n')
    expect(body).toContain('"upstream kaput"')
    expect(body.endsWith('event: done\ndata: {}\n\n')).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops enqueueing when the abort signal fires mid-stream', async () => {
    const ctrl = new AbortController()
    const after: AgentEvent = {
      kind: 'message',
      id: 'm-after-abort',
      role: 'assistant',
      content: 'should be skipped',
    }
    async function* slow(): AsyncIterable<AgentEvent> {
      yield MSG
      ctrl.abort()
      yield after
    }
    const res = streamResponseToSse({
      events: slow(),
      signal: ctrl.signal,
      log: silentLogger(),
    })
    const body = await readAll(res)
    expect(body).toContain(`data: ${JSON.stringify(MSG)}\n\n`)
    expect(body).not.toContain('m-after-abort')
    expect(body).toContain('event: done\ndata: {}\n\n')
  })
})
