import { z } from 'zod'

// Single source of truth for shipped LLM provider ids. `@brandfactory/adapter-llm`
// re-exports `LLMProviderId` from here and the server's env loader imports the
// const tuple, so widening this list once propagates everywhere a provider id
// is named without any hand-kept lockstep across packages.
export const LLM_PROVIDER_IDS = ['openrouter', 'anthropic', 'openai', 'ollama'] as const

export const LLMProviderIdSchema = z.enum(LLM_PROVIDER_IDS)

export type LLMProviderId = z.infer<typeof LLMProviderIdSchema>
