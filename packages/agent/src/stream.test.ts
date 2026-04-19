import { describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import type {
  AgentEvent,
  AgentMessage,
  BrandId,
  BrandWithSections,
  CanvasBlockId,
  CanvasId,
  ProseMirrorDoc,
  SectionId,
  TextCanvasBlock,
  WorkspaceId,
} from '@brandfactory/shared'
import type { LLMProvider, LLMProviderSettings } from '@brandfactory/adapter-llm'
import { streamResponse } from './stream'
import type { CanvasOpApplier } from './tools/applier'

const ts = '2026-04-19T00:00:00.000Z'

type StreamPart =
  | { type: 'text-delta'; textDelta: string }
  | {
      type: 'tool-call'
      toolCallType: 'function'
      toolCallId: string
      toolName: string
      args: string
    }
  | {
      type: 'finish'
      finishReason: 'stop' | 'tool-calls'
      usage: { promptTokens: number; completionTokens: number }
    }
  | { type: 'error'; error: unknown }

// Builds a minimal LanguageModelV1 that emits the supplied stream parts.
// We implement only the slice streamText actually calls against a v1 model:
// specificationVersion / provider / modelId metadata and `doStream`.
function fakeModel(parts: StreamPart[]): LanguageModel {
  const model = {
    specificationVersion: 'v1' as const,
    provider: 'fake',
    modelId: 'fake-1',
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: true,
    supportsStructuredOutputs: false,
    doGenerate: async () => {
      throw new Error('fakeModel.doGenerate should not be called')
    },
    doStream: async (_opts: unknown) => {
      const stream = new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      })
      return {
        stream,
        rawCall: { rawPrompt: null, rawSettings: {} },
      }
    },
  }
  return model as unknown as LanguageModel
}

function fakeProvider(model: LanguageModel): LLMProvider {
  return {
    getModel: () => model,
  }
}

const settings: LLMProviderSettings = {
  providerId: 'anthropic',
  modelId: 'test',
}

function makeBrand(): BrandWithSections {
  return {
    id: 'b1' as BrandId,
    workspaceId: 'w1' as WorkspaceId,
    name: 'Brand',
    description: null,
    createdAt: ts,
    updatedAt: ts,
    sections: [
      {
        id: 's1' as SectionId,
        brandId: 'b1' as BrandId,
        label: 'Voice',
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Warm.' }] }],
        },
        priority: 0,
        createdBy: 'user',
        createdAt: ts,
        updatedAt: ts,
      },
    ],
  }
}

function makeBlock(id: string, text: string, isPinned = false): TextCanvasBlock {
  return {
    id: id as CanvasBlockId,
    canvasId: 'c1' as CanvasId,
    kind: 'text',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
    position: 0,
    isPinned,
    pinnedAt: isPinned ? ts : null,
    createdBy: isPinned ? 'user' : 'agent',
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

function makeApplier(): CanvasOpApplier {
  return {
    addCanvasBlock: vi.fn(async () => makeBlock('blk_new', 'idea', false)),
    pinBlock: vi.fn(async (id: CanvasBlockId) => makeBlock(id, 'x', true)),
    unpinBlock: vi.fn(async (id: CanvasBlockId) => makeBlock(id, 'x', false)),
  }
}

async function collect(input: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of input) out.push(ev)
  return out
}

const userMessage: AgentMessage = {
  kind: 'message',
  id: 'u1',
  role: 'user',
  content: 'hi',
}

describe('streamResponse', () => {
  it('yields a single assistant message for a plain text-delta stream', async () => {
    const model = fakeModel([
      { type: 'text-delta', textDelta: 'Hello ' },
      { type: 'text-delta', textDelta: 'world.' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 } },
    ])
    const events = await collect(
      streamResponse({
        brand: makeBrand(),
        blocks: [],
        shortlistBlockIds: [],
        messages: [userMessage],
        llmProvider: fakeProvider(model),
        llmSettings: settings,
        applier: makeApplier(),
      }),
    )
    expect(events).toHaveLength(1)
    const msg = events[0]
    if (!msg || msg.kind !== 'message') throw new Error('expected a message')
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('Hello world.')
    expect(msg.id).toBeTruthy()
  })

  it('interleaves message → tool-call → synthesized canvas-op → final message', async () => {
    const args: { body: ProseMirrorDoc; position: number } = {
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
      },
      position: 0,
    }
    const model = fakeModel([
      { type: 'text-delta', textDelta: 'Adding one.' },
      {
        type: 'tool-call',
        toolCallType: 'function',
        toolCallId: 'call_1',
        toolName: 'add_canvas_block',
        args: JSON.stringify(args),
      },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { promptTokens: 1, completionTokens: 1 },
      },
    ])
    const applier = makeApplier()
    const events = await collect(
      streamResponse({
        brand: makeBrand(),
        blocks: [],
        shortlistBlockIds: [],
        messages: [userMessage],
        llmProvider: fakeProvider(model),
        llmSettings: settings,
        applier,
      }),
    )
    const kinds = events.map((e) => e.kind)
    expect(kinds).toEqual(['message', 'tool-call', 'canvas-op'])
    expect(applier.addCanvasBlock).toHaveBeenCalledWith({
      kind: 'text',
      body: args.body,
      position: 0,
    })
    const canvasOp = events[2]
    if (canvasOp?.kind !== 'canvas-op') throw new Error('expected canvas-op')
    expect(canvasOp.op.op).toBe('add-block')
  })

  it('surfaces model errors as a thrown error from the generator', async () => {
    const model = fakeModel([
      { type: 'text-delta', textDelta: 'starting…' },
      { type: 'error', error: new Error('upstream kaput') },
    ])
    const iter = streamResponse({
      brand: makeBrand(),
      blocks: [],
      shortlistBlockIds: [],
      messages: [userMessage],
      llmProvider: fakeProvider(model),
      llmSettings: settings,
      applier: makeApplier(),
    })
    await expect(collect(iter)).rejects.toThrow(/upstream kaput/)
  })
})
