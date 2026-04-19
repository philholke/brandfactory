import { RealtimeClientMessageSchema, type RealtimeServerMessage } from '@brandfactory/shared'
import type { IncomingMessage } from 'node:http'
import type { WebSocket, WebSocketServer } from 'ws'
import type { RealtimeBus, RealtimeEvent, RealtimeHandler } from './port'

export interface BindOptions {
  // Resolve a userId for the upgrading request. Throw or return null to reject.
  authenticate: (req: IncomingMessage) => Promise<string | null> | string | null
  // Optional gate to authorize a (userId, channel) pair before subscribing.
  authorize?: (ctx: { userId: string; channel: string }) => Promise<boolean> | boolean
}

export interface NativeWsRealtimeBus extends RealtimeBus {
  bindToNodeWebSocketServer(wss: WebSocketServer, opts: BindOptions): void
}

export function createNativeWsRealtimeBus(): NativeWsRealtimeBus {
  const channels = new Map<string, Set<RealtimeHandler>>()

  function subscribe(channel: string, handler: RealtimeHandler): () => void {
    let set = channels.get(channel)
    if (!set) {
      set = new Set()
      channels.set(channel, set)
    }
    set.add(handler)
    return () => {
      const current = channels.get(channel)
      if (!current) return
      current.delete(handler)
      if (current.size === 0) channels.delete(channel)
    }
  }

  async function publish(channel: string, event: RealtimeEvent): Promise<void> {
    const set = channels.get(channel)
    if (!set) return
    for (const handler of set) {
      try {
        handler(event)
      } catch {
        // Handler errors must not break the fan-out; surface via a future
        // logger when one exists (Phase 4).
      }
    }
  }

  function bindToNodeWebSocketServer(wss: WebSocketServer, opts: BindOptions): void {
    wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      void onConnection(socket, req, opts)
    })
  }

  async function onConnection(
    socket: WebSocket,
    req: IncomingMessage,
    opts: BindOptions,
  ): Promise<void> {
    let userId: string | null
    try {
      userId = await opts.authenticate(req)
    } catch {
      socket.close(4401, 'unauthorized')
      return
    }
    if (!userId) {
      socket.close(4401, 'unauthorized')
      return
    }

    const unsubscribers = new Map<string, () => void>()

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let parsed: unknown
      try {
        const text = Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.from(raw as ArrayBuffer).toString('utf8')
        parsed = JSON.parse(text)
      } catch {
        return
      }
      const result = RealtimeClientMessageSchema.safeParse(parsed)
      if (!result.success) return
      const msg = result.data

      if (msg.type === 'subscribe') {
        if (unsubscribers.has(msg.channel)) return
        // Stake the slot synchronously before awaiting authorize. Two
        // `subscribe` messages for the same channel arriving in the same tick
        // would otherwise both pass the dedup check and both register a
        // handler — the client would then receive every event twice. The
        // placeholder is replaced with the real unsubscribe once the handler
        // is registered, or deleted if authorize denies.
        const PLACEHOLDER = () => {}
        unsubscribers.set(msg.channel, PLACEHOLDER)
        const proceed = async () => {
          if (opts.authorize) {
            const ok = await opts.authorize({ userId: userId!, channel: msg.channel })
            if (!ok) {
              if (unsubscribers.get(msg.channel) === PLACEHOLDER) {
                unsubscribers.delete(msg.channel)
              }
              return
            }
          }
          // Socket may have closed during the await — `close` clears the map.
          if (unsubscribers.get(msg.channel) !== PLACEHOLDER) return
          const off = subscribe(msg.channel, (event) => {
            const out: RealtimeServerMessage = {
              type: 'event',
              channel: msg.channel,
              payload: event,
            }
            try {
              socket.send(JSON.stringify(out))
            } catch {
              // socket may have closed mid-fan-out; ignore.
            }
          })
          unsubscribers.set(msg.channel, off)
        }
        void proceed()
        return
      }

      if (msg.type === 'unsubscribe') {
        const off = unsubscribers.get(msg.channel)
        if (off) {
          off()
          unsubscribers.delete(msg.channel)
        }
      }
    })

    socket.on('close', () => {
      for (const off of unsubscribers.values()) off()
      unsubscribers.clear()
    })
  }

  return { publish, subscribe, bindToNodeWebSocketServer }
}
