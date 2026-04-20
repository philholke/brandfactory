import { RealtimeServerMessageSchema } from '@brandfactory/shared'
import type { AgentEvent, RealtimeChannel } from '@brandfactory/shared'
import { getAuthToken } from '@/auth/store'

type Handler = (payload: AgentEvent) => void
type ResyncHandler = () => void

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

function toWsUrl(url: string): string {
  if (url.startsWith('/')) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}${url}`
  }
  // Replace http(s):// → ws(s)://
  return url.replace(/^http/, 'ws')
}

// Single shared WebSocket to the server's /rt endpoint. Multiplexes many
// channel subscriptions over one connection with ref-counting: the socket
// opens on the first subscriber and closes when the last one unmounts.
class RealtimeClient {
  private ws: WebSocket | null = null
  private state: 'idle' | 'connecting' | 'open' | 'reconnecting' = 'idle'
  private channels = new Map<RealtimeChannel, Set<Handler>>()
  private resyncHandlers = new Set<ResyncHandler>()
  private backoffMs = MIN_BACKOFF_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectionCount = 0

  subscribe(channel: RealtimeChannel, handler: Handler): () => void {
    let handlers = this.channels.get(channel)
    if (!handlers) {
      handlers = new Set()
      this.channels.set(channel, handlers)
    }
    handlers.add(handler)

    if (this.state === 'idle') {
      this.connect()
    } else if (this.state === 'open') {
      this.send({ type: 'subscribe', channel })
    }
    // If 'connecting' or 'reconnecting', onOpen sends all subscriptions.

    return () => {
      const handlers = this.channels.get(channel)
      if (!handlers) return
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.channels.delete(channel)
        if (this.state === 'open') {
          this.send({ type: 'unsubscribe', channel })
        }
        if (this.channels.size === 0) {
          this.closeSocket()
        }
      }
    }
  }

  // Registers a callback fired on every reconnect (not the initial connect).
  // Consumers use this to invalidate React Query caches after a WS outage.
  onResynced(handler: ResyncHandler): () => void {
    this.resyncHandlers.add(handler)
    return () => {
      this.resyncHandlers.delete(handler)
    }
  }

  private connect() {
    this.state = 'connecting'
    const token = getAuthToken()
    const base = import.meta.env.VITE_RT_URL ?? '/rt'
    const qs = token ? `?token=${encodeURIComponent(token)}` : ''
    const wsUrl = toWsUrl(`${base}${qs}`)

    const ws = new WebSocket(wsUrl)
    this.ws = ws
    ws.addEventListener('open', this.onOpen)
    ws.addEventListener('message', this.onMessage)
    ws.addEventListener('close', this.onClose)
  }

  private closeSocket() {
    this.state = 'idle'
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeEventListener('open', this.onOpen)
      this.ws.removeEventListener('message', this.onMessage)
      this.ws.removeEventListener('close', this.onClose)
      this.ws.close()
      this.ws = null
    }
  }

  private onOpen = () => {
    this.state = 'open'
    this.connectionCount++
    this.backoffMs = MIN_BACKOFF_MS

    for (const channel of this.channels.keys()) {
      this.send({ type: 'subscribe', channel })
    }

    // Fire resync on reconnects so consumers can refetch stale data.
    if (this.connectionCount > 1) {
      for (const handler of this.resyncHandlers) {
        handler()
      }
    }
  }

  private onMessage = (event: MessageEvent) => {
    let raw: unknown
    try {
      raw = JSON.parse(event.data as string)
    } catch {
      return
    }
    const result = RealtimeServerMessageSchema.safeParse(raw)
    if (!result.success) return // guard against a compromised bus

    const msg = result.data
    if (msg.type === 'event') {
      const handlers = this.channels.get(msg.channel)
      if (handlers) {
        for (const handler of handlers) {
          handler(msg.payload)
        }
      }
    }
  }

  private onClose = () => {
    this.ws = null
    if (this.state === 'idle') return // intentional close
    this.state = 'reconnecting'
    this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (this.channels.size === 0) {
      this.state = 'idle'
      return
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}

export const realtimeClient = new RealtimeClient()
