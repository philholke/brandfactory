import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModuleImport from './client'

// Minimal fake WebSocket capturing handlers and sent frames so we can drive
// the `RealtimeClient` state machine deterministically. The real DOM
// WebSocket is replaced via `vi.stubGlobal` before each test.
class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  url: string
  private listeners: Record<string, Array<(ev: unknown) => void>> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(kind: string, fn: (ev: unknown) => void) {
    ;(this.listeners[kind] ??= []).push(fn)
  }

  removeEventListener(kind: string, fn: (ev: unknown) => void) {
    this.listeners[kind] = (this.listeners[kind] ?? []).filter((f) => f !== fn)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }

  // Drivers — call from tests to push state transitions into the client.
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    for (const l of this.listeners.open ?? []) l({})
  }

  fireMessage(data: string) {
    for (const l of this.listeners.message ?? []) l({ data })
  }

  fireClose() {
    this.readyState = FakeWebSocket.CLOSED
    for (const l of this.listeners.close ?? []) l({})
  }
}

describe('RealtimeClient', () => {
  let realtimeClient: typeof ClientModuleImport.realtimeClient

  beforeEach(async () => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
    // Fresh module — the singleton's internal state resets between tests.
    vi.resetModules()
    ;({ realtimeClient } = await import('./client'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens a socket on first subscribe and sends subscribe after onOpen', () => {
    const handler = vi.fn()
    realtimeClient.subscribe('project:p1', handler)

    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]!
    expect(ws.sent).toEqual([])

    ws.fireOpen()
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'subscribe', channel: 'project:p1' })
  })

  it('dispatches validated event frames to the matching channel handler', () => {
    const handler = vi.fn()
    realtimeClient.subscribe('project:p1', handler)
    const ws = FakeWebSocket.instances[0]!
    ws.fireOpen()

    const payload = { kind: 'message', id: 'm1', role: 'assistant', content: 'hi' }
    ws.fireMessage(JSON.stringify({ type: 'event', channel: 'project:p1', payload }))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(payload)
  })

  it('drops malformed frames silently', () => {
    const handler = vi.fn()
    realtimeClient.subscribe('project:p1', handler)
    const ws = FakeWebSocket.instances[0]!
    ws.fireOpen()

    ws.fireMessage('not-json')
    ws.fireMessage(
      JSON.stringify({ type: 'event', channel: 'project:p1', payload: { bogus: true } }),
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('routes frames to the right channel only', () => {
    const a = vi.fn()
    const b = vi.fn()
    realtimeClient.subscribe('project:a', a)
    realtimeClient.subscribe('project:b', b)
    const ws = FakeWebSocket.instances[0]!
    ws.fireOpen()

    const payload = { kind: 'message', id: 'm', role: 'assistant', content: 'x' }
    ws.fireMessage(JSON.stringify({ type: 'event', channel: 'project:a', payload }))

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('ref-counts subscribers on the same channel — second subscribe does not open a new socket', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    realtimeClient.subscribe('project:p1', h1)
    const ws = FakeWebSocket.instances[0]!
    ws.fireOpen()

    realtimeClient.subscribe('project:p1', h2)
    expect(FakeWebSocket.instances).toHaveLength(1)

    const payload = { kind: 'message', id: 'm', role: 'assistant', content: 'x' }
    ws.fireMessage(JSON.stringify({ type: 'event', channel: 'project:p1', payload }))
    expect(h1).toHaveBeenCalled()
    expect(h2).toHaveBeenCalled()
  })

  it('closes the socket when the last subscriber on the last channel unmounts', () => {
    const h = vi.fn()
    const unsub = realtimeClient.subscribe('project:p1', h)
    const ws = FakeWebSocket.instances[0]!
    ws.fireOpen()

    unsub()

    // unsubscribe frame emitted before socket closes
    const last = JSON.parse(ws.sent.at(-1) as string)
    expect(last).toEqual({ type: 'unsubscribe', channel: 'project:p1' })
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED)
  })

  it('keeps the socket open while other channels still have subscribers', () => {
    const ha = vi.fn()
    const hb = vi.fn()
    const unsubA = realtimeClient.subscribe('project:a', ha)
    realtimeClient.subscribe('project:b', hb)
    const ws = FakeWebSocket.instances[0]!
    ws.fireOpen()

    unsubA()

    expect(ws.readyState).toBe(FakeWebSocket.OPEN)
    // The unsubscribe frame went out for 'a' but the socket stays up for 'b'.
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual(
      expect.arrayContaining([{ type: 'unsubscribe', channel: 'project:a' }]),
    )
  })

  it('reconnects with exponential backoff after an unexpected close', () => {
    const h = vi.fn()
    realtimeClient.subscribe('project:p1', h)
    const ws1 = FakeWebSocket.instances[0]!
    ws1.fireOpen()
    ws1.fireClose()

    // Before the backoff timer fires, no new socket.
    expect(FakeWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(1_000) // MIN_BACKOFF_MS
    expect(FakeWebSocket.instances).toHaveLength(2)
    const ws2 = FakeWebSocket.instances[1]!
    ws2.fireOpen()

    // Re-subscribed on the new socket.
    expect(JSON.parse(ws2.sent[0]!)).toEqual({ type: 'subscribe', channel: 'project:p1' })

    // Backoff resets on a successful onOpen, so the next close schedules at
    // MIN_BACKOFF_MS again.
    ws2.fireClose()
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('fires onResynced handlers on reconnects only, not on the first connect', () => {
    const resynced = vi.fn()
    realtimeClient.onResynced(resynced)

    const h = vi.fn()
    realtimeClient.subscribe('project:p1', h)
    const ws1 = FakeWebSocket.instances[0]!
    ws1.fireOpen()
    expect(resynced).not.toHaveBeenCalled()

    ws1.fireClose()
    vi.advanceTimersByTime(1_000)
    const ws2 = FakeWebSocket.instances[1]!
    ws2.fireOpen()
    expect(resynced).toHaveBeenCalledTimes(1)
  })
})
