import { describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'
import { createLLMProvider } from './factory'
import { ProviderNotConfiguredError } from './port'

const fakeModel = { id: 'fake' } as unknown as LanguageModel

describe('createLLMProvider', () => {
  it('builds and caches the per-provider factory', () => {
    const buildAnthropic = vi.fn(({ apiKey: _ }: { apiKey: string }) => {
      const factory = vi.fn((_modelId: string) => fakeModel)
      return factory
    })
    const llm = createLLMProvider({ anthropic: { apiKey: 'k' } }, { buildAnthropic })
    const m1 = llm.getModel({ providerId: 'anthropic', modelId: 'claude-x' })
    const m2 = llm.getModel({ providerId: 'anthropic', modelId: 'claude-y' })
    expect(m1).toBe(fakeModel)
    expect(m2).toBe(fakeModel)
    expect(buildAnthropic).toHaveBeenCalledTimes(1)
    expect(buildAnthropic).toHaveBeenCalledWith({ apiKey: 'k' })
  })

  it('passes the modelId to the per-provider factory', () => {
    const innerFactory = vi.fn((_modelId: string) => fakeModel)
    const buildOpenAI = vi.fn(() => innerFactory)
    const llm = createLLMProvider({ openai: { apiKey: 'k' } }, { buildOpenAI })
    llm.getModel({ providerId: 'openai', modelId: 'gpt-foo' })
    expect(innerFactory).toHaveBeenCalledWith('gpt-foo')
  })

  it('passes baseURL through for openrouter', () => {
    const buildOpenRouter = vi.fn(() => () => fakeModel)
    const llm = createLLMProvider(
      { openrouter: { apiKey: 'k', baseURL: 'https://r.test' } },
      { buildOpenRouter },
    )
    llm.getModel({ providerId: 'openrouter', modelId: 'meta/llama' })
    expect(buildOpenRouter).toHaveBeenCalledWith({
      apiKey: 'k',
      baseURL: 'https://r.test',
    })
  })

  it('allows ollama with no config (defaults to local)', () => {
    const buildOllama = vi.fn(() => () => fakeModel)
    const llm = createLLMProvider({}, { buildOllama })
    llm.getModel({ providerId: 'ollama', modelId: 'llama3' })
    expect(buildOllama).toHaveBeenCalledWith({})
  })

  it('throws ProviderNotConfiguredError when API-key provider is unconfigured', () => {
    const llm = createLLMProvider({})
    expect(() => llm.getModel({ providerId: 'anthropic', modelId: 'x' })).toThrow(
      ProviderNotConfiguredError,
    )
  })
})
