import type { LanguageModel } from 'ai'
import type { LLMProviderId } from '@brandfactory/shared'

// Re-export so existing `import { LLMProviderId } from '@brandfactory/adapter-llm'`
// call sites keep working. Source of truth lives in `@brandfactory/shared` so
// shared, adapter-llm, and the server's env loader can't drift.
export type { LLMProviderId }

export interface LLMProviderSettings {
  providerId: LLMProviderId
  modelId: string
}

export interface LLMProvider {
  getModel(settings: LLMProviderSettings): LanguageModel
}

export interface LLMProviderConfig {
  openrouter?: { apiKey: string; baseURL?: string }
  anthropic?: { apiKey: string }
  openai?: { apiKey: string }
  ollama?: { baseURL?: string }
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: LLMProviderId) {
    super(`LLM provider not configured: ${providerId}`)
    this.name = 'ProviderNotConfiguredError'
  }
}

export type { LanguageModel }
