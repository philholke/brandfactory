import { z } from 'zod'
import { CanvasBlockIdSchema } from '../ids'
import { JsonValueSchema } from '../json'
import { CanvasBlockSchema } from '../project/canvas'

export const AgentMessageSchema = z.object({
  kind: z.literal('message'),
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

export type AgentMessage = z.infer<typeof AgentMessageSchema>

export const AgentToolCallSchema = z.object({
  kind: z.literal('tool-call'),
  callId: z.string().min(1),
  toolName: z.string().min(1),
  args: JsonValueSchema,
})

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>

// Canvas mutations issued by the agent. Discriminated on `op`.
const AddBlockOpSchema = z.object({
  op: z.literal('add-block'),
  block: CanvasBlockSchema,
})

const UpdateBlockOpSchema = z.object({
  op: z.literal('update-block'),
  blockId: CanvasBlockIdSchema,
  patch: JsonValueSchema,
})

const RemoveBlockOpSchema = z.object({
  op: z.literal('remove-block'),
  blockId: CanvasBlockIdSchema,
})

export const CanvasOpSchema = z.discriminatedUnion('op', [
  AddBlockOpSchema,
  UpdateBlockOpSchema,
  RemoveBlockOpSchema,
])

export type CanvasOp = z.infer<typeof CanvasOpSchema>

const PinOpPinSchema = z.object({
  op: z.literal('pin'),
  blockId: CanvasBlockIdSchema,
})

const PinOpUnpinSchema = z.object({
  op: z.literal('unpin'),
  blockId: CanvasBlockIdSchema,
})

export const PinOpSchema = z.discriminatedUnion('op', [PinOpPinSchema, PinOpUnpinSchema])
export type PinOp = z.infer<typeof PinOpSchema>

// Event envelopes that wrap the ops so they flow in a single `kind`-tagged
// stream alongside messages and tool-calls.
export const CanvasOpEventSchema = z.object({
  kind: z.literal('canvas-op'),
  op: CanvasOpSchema,
})

export type CanvasOpEvent = z.infer<typeof CanvasOpEventSchema>

export const PinOpEventSchema = z.object({
  kind: z.literal('pin-op'),
  op: PinOpSchema,
})

export type PinOpEvent = z.infer<typeof PinOpEventSchema>

// Outer union is a plain z.union rather than z.discriminatedUnion because
// `CanvasOpEventSchema` / `PinOpEventSchema` wrap an inner union on `op` —
// z.discriminatedUnion requires each branch to be a single z.object. The
// performance cost at parse time is negligible for streamed events.
export const AgentEventSchema = z.union([
  AgentMessageSchema,
  AgentToolCallSchema,
  CanvasOpEventSchema,
  PinOpEventSchema,
])

export type AgentEvent = z.infer<typeof AgentEventSchema>
