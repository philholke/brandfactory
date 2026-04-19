import { RealtimeClientMessageSchema, type RealtimeServerMessage } from '@brandfactory/shared'
import type { IncomingMessage } from 'node:http'
import type { WebSocket, WebSocketServer } from 'ws'
import type { RealtimeBus, RealtimeEvent, RealtimeHandler } from './port'

export interface BindOptions {
  // Resolve a userId for the upgrading request. Throw or return null to reject.
  authenticate: (req: IncomingMessage) => Promise<string | null> | string | null
  // Optional gate to authorize a (userId, channel) pair before subscribing.
  authorize?: (ctx: { userId: string; channel: string }) => Promise<boolean> | boolean
  // Heartbeat interval. Every tick the bus pings each live socket; sockets
  // that didn't pong since the previous tick are `terminate()`d. Defaults
  // to 30s — override in tests to force a faster sweep.
  heartbeatIntervalMs?: number
}

export interface NativeWsRealtimeBus extends RealtimeBus {
  bindToNodeWebSocketServer(wss: WebSocketServer, opts: BindOptions): void
}

const DEFAULT_HEARTBEAT_MS = 30_000

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
    // Heartbeat sweep: zombie sockets (client vanished without a close
    // frame — network drop, mobile suspend, browser crash) pile up
    // otherwise and we'd keep fanning events into dead send buffers.
    // Each live socket tags itself alive on `pong`; any socket that didn't
    // pong between two ticks gets `terminate()`d so its `close` handler
    // runs and clears its subscriptions.
    const intervalMs = opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS
    const heartbeat = setInterval(() => {
      for (const socket of wss.clients) {
        const tagged = socket as WebSocket & { isAlive?: boolean }
        if (tagged.isAlive === false) {
          socket.terminate()
          continue
        }
        tagged.isAlive = false
        try {
          socket.ping()
        } catch {
          // send buffer full or socket already torn down; next sweep evicts.
        }
      }
    }, intervalMs)
    // Node keeps the process alive as long as any timer is pending; the
    // heartbeat is infrastructural, not work, so unref it.
    heartbeat.unref()
    wss.on('close', () => clearInterval(heartbeat))

    wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      const tagged = socket as WebSocket & { isAlive?: boolean }
      tagged.isAlive = true
      socket.on('pong', () => {
        tagged.isAlive = true
      })
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
