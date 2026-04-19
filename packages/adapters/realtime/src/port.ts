import type { AgentEvent, CanvasOpEvent, PinOpEvent } from '@brandfactory/shared'

// Pub/sub bus for events the server needs to fan out to subscribed clients.
// HTTP/WS upgrade lives in `packages/server` (Phase 4) — adapters expose
// only the in-process publish/subscribe surface.
export type RealtimeEvent = AgentEvent | CanvasOpEvent | PinOpEvent

export type RealtimeHandler = (event: RealtimeEvent) => void

export interface RealtimeBus {
  publish(channel: string, event: RealtimeEvent): Promise<void>
  // subscribe returns its own unsubscribe; callers don't need to track handler refs.
  subscribe(channel: string, handler: RealtimeHandler): () => void
}
