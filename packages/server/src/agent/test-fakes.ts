import type { LanguageModel, LLMProvider } from '@brandfactory/adapter-llm'

// Mirrors the AI-SDK v1 stream-part shape that `streamText` reads. Kept
// here (rather than re-imported from `@brandfactory/agent`) because
// the agent package does not re-export its stream-test helpers — and
// duplicating the small fake is cheaper than a public test-support
// surface that has only one consumer in v1.
export type FakeStreamPart =
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

export function fakeModel(parts: FakeStreamPart[]): LanguageModel {
  return makeAsyncModel(async function* () {
    for (const part of parts) yield part
  })
}

// Async-iterable variant that lets a test pause emission until a deferred is
// resolved — used by the concurrency test to hold the first turn open long
// enough for the second request to race it. The `ReadableStream` adapter
// awaits each pulled value, so a generator that awaits inside its body
// translates to a stream that backpressures naturally.
export function makeAsyncModel(
  gen: () => AsyncGenerator<FakeStreamPart, void, void>,
): LanguageModel {
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
      const iter = gen()
      const stream = new ReadableStream({
        async pull(controller) {
          const next = await iter.next()
          if (next.done) controller.close()
          else controller.enqueue(next.value)
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

export function fakeProvider(model: LanguageModel): LLMProvider {
  return {
    getModel: () => model,
  }
}
