import { z } from 'zod'
import { AgentEventSchema, CanvasOpEventSchema, PinOpEventSchema } from '../agent/events'

// Outer wire envelope spoken between the browser and the server's WS
// endpoint. Lives in shared so both `web` and `server` can validate the
// same protocol — adapter packages are server-only and `web` can't
// import from them.

export const RealtimeChannelSchema = z.string().min(1)
export type RealtimeChannel = z.infer<typeof RealtimeChannelSchema>

export const RealtimeEventPayloadSchema = z.union([
  AgentEventSchema,
  CanvasOpEventSchema,
  PinOpEventSchema,
])
export type RealtimeEventPayload = z.infer<typeof RealtimeEventPayloadSchema>

export const RealtimeSubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  channel: RealtimeChannelSchema,
})

export const RealtimeUnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  channel: RealtimeChannelSchema,
})

export const RealtimeClientMessageSchema = z.discriminatedUnion('type', [
  RealtimeSubscribeMessageSchema,
  RealtimeUnsubscribeMessageSchema,
])
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>

export const RealtimeEventMessageSchema = z.object({
  type: z.literal('event'),
  channel: RealtimeChannelSchema,
  payload: RealtimeEventPayloadSchema,
})

export const RealtimeServerMessageSchema = z.discriminatedUnion('type', [
  RealtimeEventMessageSchema,
])
export type RealtimeServerMessage = z.infer<typeof RealtimeServerMessageSchema>
