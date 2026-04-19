import { randomUUID } from 'node:crypto'
import { streamText, type CoreMessage } from 'ai'
import type { LLMProvider, LLMProviderSettings } from '@brandfactory/adapter-llm'
import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
  BrandWithSections,
  CanvasBlock,
  CanvasBlockId,
  CanvasOp,
  CanvasOpEvent,
  JsonValue,
  PinOpEvent,
} from '@brandfactory/shared'
import { buildCanvasContext } from './prompts/canvas-context'
import { buildSystemPrompt } from './prompts/system-prompt'
import { buildCanvasTools } from './tools/definitions'
import type { CanvasOpApplier } from './tools/applier'

export interface StreamResponseInput {
  brand: BrandWithSections
  blocks: CanvasBlock[]
  shortlistBlockIds: CanvasBlockId[]
  recentOps?: CanvasOp[]
  messages: AgentMessage[]
  llmProvider: LLMProvider
  llmSettings: LLMProviderSettings
  applier: CanvasOpApplier
  signal?: AbortSignal
}

// Composes (system prompt + canvas context + tools) and streams a typed
// `AgentEvent` iterable against the injected `LLMProvider`. The package
// is server-only but has no DB / realtime / HTTP deps — all side effects
// flow through the injected `applier`. Phase 6 wires this into the
// `POST /projects/:id/agent` route and forwards events to SSE + the
// realtime bus.
export function streamResponse(input: StreamResponseInput): AsyncIterable<AgentEvent> {
  return run(input)
}

async function* run(input: StreamResponseInput): AsyncIterable<AgentEvent> {
  const systemPrompt = buildSystemPrompt(input.brand)
  const canvasContext = buildCanvasContext({
    blocks: input.blocks,
    shortlistBlockIds: input.shortlistBlockIds,
    recentOps: input.recentOps,
  })
  // Canvas context is prepended to `system` (not injected as a user
  // message) so the model treats it as static context, not something to
  // respond to directly.
  const system = `${systemPrompt}\n\n${canvasContext}`

  const pendingByToolCall = new Map<string, CanvasOpEvent | PinOpEvent>()
  const tools = buildCanvasTools(input.applier, {
    onApplied: (toolCallId, event) => {
      pendingByToolCall.set(toolCallId, event)
    },
  })

  const modelMessages: CoreMessage[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const result = streamText({
    model: input.llmProvider.getModel(input.llmSettings),
    system,
    messages: modelMessages,
    tools,
    abortSignal: input.signal,
  })

  let currentMessageId: string | null = null
  let currentContent = ''

  function takeMessage(): AgentMessage | null {
    if (currentMessageId === null) return null
    const msg: AgentMessage = {
      kind: 'message',
      id: currentMessageId,
      role: 'assistant',
      content: currentContent,
    }
    currentMessageId = null
    currentContent = ''
    return msg
  }

  // Widened stream-part type. The AI SDK's exported `TextStreamPart<TOOLS>`
  // narrows the `tool-result` / `tool-call` arms through `ToolResultUnion`
  // / `ToolCallUnion`, which collapse to `never` when TOOLS is the generic
  // `ToolSet` — so the matching switch branches get elided from the union
  // even though the runtime emits them. We re-declare the minimal shape we
  // consume here.
  type AgentStreamPart =
    | { type: 'text-delta'; textDelta: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
    | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown }
    | { type: 'step-finish' }
    | { type: 'finish' }
    | { type: 'error'; error: unknown }
    // Other runtime-emitted kinds (reasoning, source, file, step-start,
    // tool-call-streaming-*) are ignored; `_other` makes the switch
    // exhaustive without losing narrowing on the above arms.
    | {
        type:
          | 'reasoning'
          | 'reasoning-signature'
          | 'redacted-reasoning'
          | 'source'
          | 'file'
          | 'step-start'
          | 'tool-call-streaming-start'
          | 'tool-call-delta'
      }
  const stream = result.fullStream as unknown as AsyncIterable<AgentStreamPart>
  for await (const part of stream) {
    switch (part.type) {
      case 'text-delta': {
        if (currentMessageId === null) currentMessageId = randomUUID()
        currentContent += part.textDelta
        break
      }
      case 'tool-call': {
        const flushed = takeMessage()
        if (flushed) yield flushed
        const toolCall: AgentToolCall = {
          kind: 'tool-call',
          callId: part.toolCallId,
          toolName: part.toolName,
          args: part.args as JsonValue,
        }
        yield toolCall
        break
      }
      case 'tool-result': {
        const event = pendingByToolCall.get(part.toolCallId)
        if (event) {
          pendingByToolCall.delete(part.toolCallId)
          yield event
        }
        break
      }
      case 'step-finish':
      case 'finish': {
        const flushed = takeMessage()
        if (flushed) yield flushed
        break
      }
      case 'error': {
        throw part.error instanceof Error
          ? part.error
          : new Error(`agent stream error: ${String(part.error)}`)
      }
      default:
        // Other part kinds (reasoning, source, file, step-start,
        // tool-call-streaming-*) are ignored in v1. Revisit when we add
        // reasoning surfaces or streaming tool-arg UIs.
        break
    }
  }

  const trailing = takeMessage()
  if (trailing) yield trailing
}
