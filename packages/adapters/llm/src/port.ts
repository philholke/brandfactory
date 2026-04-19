import type { LanguageModel } from 'ai'

export type LLMProviderId = 'openrouter' | 'anthropic' | 'openai' | 'ollama'

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
