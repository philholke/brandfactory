import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentMessage } from '@brandfactory/shared'
import { createNativeWsRealtimeBus } from './native-ws'

interface Harness {
  url: string
  close: () => Promise<void>
  bus: ReturnType<typeof createNativeWsRealtimeBus>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function startBus(
  opts: { authenticate?: (req: unknown) => string | null } = {},
): Promise<Harness> {
  const bus = createNativeWsRealtimeBus()
  const http = createServer()
  const wss = new WebSocketServer({ server: http })
  bus.bindToNodeWebSocketServer(wss, {
    authenticate: opts.authenticate ?? (() => 'user-1'),
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const addr = http.address()
  if (addr === null || typeof addr === 'string') throw new Error('no address')
  const url = `ws://127.0.0.1:${addr.port}`
  const close = async () => {
    await new Promise<void>((r) => wss.close(() => r()))
    await new Promise<void>((r) => http.close(() => r()))
  }
  cleanups.push(close)
  return { url, close, bus }
}

function makeClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try {
        resolve(JSON.parse(raw.toString()))
      } catch (err) {
        reject(err)
      }
    })
  })
}

const helloEvent: AgentMessage = { kind: 'message', id: 'm1', role: 'assistant', content: 'hi' }

describe('native-ws realtime bus', () => {
  it('in-process publish/subscribe fans out to subscribers', async () => {
    const { bus, close } = await startBus()
    const seen: string[] = []
    const off = bus.subscribe('chan', (e) => {
      if (e.kind === 'message') seen.push(e.content)
    })
    await bus.publish('chan', helloEvent)
    expect(seen).toEqual(['hi'])
    off()
    await bus.publish('chan', helloEvent)
    expect(seen).toEqual(['hi'])
    await close()
  })

  it('fans events to two WS clients on the same channel', async () => {
    const { url, bus } = await startBus()
    const a = await makeClient(url)
    const b = await makeClient(url)
    a.send(JSON.stringify({ type: 'subscribe', channel: 'shared' }))
    b.send(JSON.stringify({ type: 'subscribe', channel: 'shared' }))
    // wait a tick for subscribes to register
    await new Promise((r) => setTimeout(r, 25))

    const aWait = nextMessage(a)
    const bWait = nextMessage(b)
    await bus.publish('shared', helloEvent)

    const [aMsg, bMsg] = await Promise.all([aWait, bWait])
    for (const m of [aMsg, bMsg]) {
      const obj = m as { type: string; channel: string; payload: { content: string } }
      expect(obj.type).toBe('event')
      expect(obj.channel).toBe('shared')
      expect(obj.payload.content).toBe('hi')
    }
    a.close()
    b.close()
  })

  it('unsubscribe stops further delivery', async () => {
    const { url, bus } = await startBus()
    const c = await makeClient(url)
    c.send(JSON.stringify({ type: 'subscribe', channel: 'x' }))
    await new Promise((r) => setTimeout(r, 25))

    const first = nextMessage(c)
    await bus.publish('x', helloEvent)
    await first

    c.send(JSON.stringify({ type: 'unsubscribe', channel: 'x' }))
    await new Promise((r) => setTimeout(r, 25))

    let received = false
    c.once('message', () => {
      received = true
    })
    await bus.publish('x', helloEvent)
    await new Promise((r) => setTimeout(r, 50))
    expect(received).toBe(false)
    c.close()
  })

  it('dedups same-tick subscribes to the same channel (no double-fan-out)', async () => {
    // Authorize is async, so the second subscribe arrives before the first
    // resolves. Without the placeholder-stake guard, both would register a
    // handler and the client would receive every published event twice.
    const bus = createNativeWsRealtimeBus()
    const http = createServer()
    const wss = new WebSocketServer({ server: http })
    let authorizeCalls = 0
    bus.bindToNodeWebSocketServer(wss, {
      authenticate: () => 'user-1',
      authorize: async () => {
        authorizeCalls += 1
        await new Promise((r) => setTimeout(r, 25))
        return true
      },
    })
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
    const addr = http.address()
    if (addr === null || typeof addr === 'string') throw new Error('no address')
    const url = `ws://127.0.0.1:${addr.port}`
    cleanups.push(async () => {
      await new Promise<void>((r) => wss.close(() => r()))
      await new Promise<void>((r) => http.close(() => r()))
    })

    const c = await makeClient(url)
    c.send(JSON.stringify({ type: 'subscribe', channel: 'dup' }))
    c.send(JSON.stringify({ type: 'subscribe', channel: 'dup' }))
    // Wait for both authorize promises to resolve.
    await new Promise((r) => setTimeout(r, 75))

    const received: unknown[] = []
    c.on('message', (raw) => received.push(JSON.parse(raw.toString())))
    await bus.publish('dup', helloEvent)
    await new Promise((r) => setTimeout(r, 25))

    // Second subscribe is staked-out by the placeholder, so authorize runs
    // exactly once and the handler is registered exactly once.
    expect(authorizeCalls).toBe(1)
    expect(received).toHaveLength(1)
    c.close()
  })

  it('rejects connections that fail authentication', async () => {
    const { url } = await startBus({ authenticate: () => null })
    const ws = new WebSocket(url)
    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.once('close', (code) => resolve(code))
      ws.once('error', reject)
    })
    expect(closeCode).toBe(4401)
  })
})
