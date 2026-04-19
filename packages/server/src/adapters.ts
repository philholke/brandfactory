import {
  type AuthProvider,
  createLocalAuthProvider,
  createSupabaseAuthProvider,
} from '@brandfactory/adapter-auth'
import {
  type BlobStore,
  createLocalDiskBlobStore,
  createSupabaseBlobStore,
} from '@brandfactory/adapter-storage'
import { type RealtimeBus, createNativeWsRealtimeBus } from '@brandfactory/adapter-realtime'
import {
  type LLMProvider,
  type LLMProviderConfig,
  createLLMProvider,
} from '@brandfactory/adapter-llm'
import type { Env } from './env'

export interface Adapters {
  auth: AuthProvider
  storage: BlobStore
  realtime: RealtimeBus
  llm: LLMProvider
}

export function buildAdapters(env: Env): Adapters {
  const auth: AuthProvider =
    env.AUTH_PROVIDER === 'local'
      ? createLocalAuthProvider()
      : createSupabaseAuthProvider({
          jwksUrl: env.SUPABASE_JWKS_URL!,
          audience: env.SUPABASE_JWT_AUDIENCE,
          issuer: env.SUPABASE_JWT_ISSUER,
        })

  const storage: BlobStore =
    env.STORAGE_PROVIDER === 'local-disk'
      ? createLocalDiskBlobStore({
          rootDir: env.BLOB_LOCAL_DISK_ROOT!,
          signingSecret: env.BLOB_SIGNING_SECRET!,
          publicBaseUrl: env.BLOB_PUBLIC_BASE_URL!,
        })
      : createSupabaseBlobStore({
          url: env.SUPABASE_URL!,
          serviceKey: env.SUPABASE_SERVICE_KEY!,
          bucket: env.SUPABASE_STORAGE_BUCKET!,
        })

  // Only one realtime impl ships in Phase 3; widen as more land (decision 15).
  const realtime: RealtimeBus = createNativeWsRealtimeBus()

  const llmConfig: LLMProviderConfig = {}
  if (env.ANTHROPIC_API_KEY) {
    llmConfig.anthropic = { apiKey: env.ANTHROPIC_API_KEY }
  }
  if (env.OPENAI_API_KEY) {
    llmConfig.openai = { apiKey: env.OPENAI_API_KEY }
  }
  if (env.OPENROUTER_API_KEY) {
    llmConfig.openrouter = {
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: env.OPENROUTER_BASE_URL,
    }
  }
  llmConfig.ollama = { baseURL: env.OLLAMA_BASE_URL }
  const llm: LLMProvider = createLLMProvider(llmConfig)

  return { auth, storage, realtime, llm }
}
