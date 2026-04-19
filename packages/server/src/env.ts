import { z } from 'zod'
import { LLM_PROVIDER_IDS } from '@brandfactory/shared'

// Single env schema for the server. Per locked decision 13, every adapter
// gets discrete env vars (not a JSON blob); per locked decision 15, the
// `*_PROVIDER` enums only list shipped impls — adding a future provider
// widens the enum *and* the buildAdapters switch in lockstep.
//
// `LLM_PROVIDER_IDS` lives in `@brandfactory/shared` (single source of truth);
// `@brandfactory/adapter-llm` re-exports the type from there too. Widening the
// list anywhere fails compile in every consumer.

const NonEmpty = z.string().min(1)

export const EnvSchema = z
  .object({
    // Database (already in use by @brandfactory/db).
    DATABASE_URL: NonEmpty,

    // Auth provider.
    AUTH_PROVIDER: z.enum(['local', 'supabase']),

    // Storage provider.
    STORAGE_PROVIDER: z.enum(['local-disk', 'supabase']),

    // Realtime provider. Only one impl ships in Phase 3 — the enum widens
    // when a second impl lands so misconfigured envs fail at boot.
    REALTIME_PROVIDER: z.enum(['native-ws']),

    // LLM (active provider + model). Phase 3 reads from env only; workspace
    // overrides land with Phase 4's settings route.
    LLM_PROVIDER: z.enum(LLM_PROVIDER_IDS),
    LLM_MODEL: NonEmpty,

    // Local-disk blob store config.
    BLOB_LOCAL_DISK_ROOT: NonEmpty.optional(),
    BLOB_SIGNING_SECRET: NonEmpty.optional(),
    BLOB_PUBLIC_BASE_URL: NonEmpty.optional(),

    // Supabase (auth + storage share these).
    SUPABASE_URL: NonEmpty.optional(),
    SUPABASE_ANON_KEY: NonEmpty.optional(),
    SUPABASE_SERVICE_KEY: NonEmpty.optional(),
    SUPABASE_JWKS_URL: NonEmpty.optional(),
    SUPABASE_JWT_AUDIENCE: NonEmpty.optional(),
    SUPABASE_JWT_ISSUER: NonEmpty.optional(),
    SUPABASE_STORAGE_BUCKET: NonEmpty.optional(),

    // LLM provider keys.
    ANTHROPIC_API_KEY: NonEmpty.optional(),
    OPENAI_API_KEY: NonEmpty.optional(),
    OPENROUTER_API_KEY: NonEmpty.optional(),
    OPENROUTER_BASE_URL: NonEmpty.optional(),
    OLLAMA_BASE_URL: NonEmpty.optional(),

    // HTTP server (Phase 4).
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: NonEmpty.default('0.0.0.0'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    function require_(field: keyof typeof env, when: string) {
      if (!env[field]) {
        ctx.addIssue({
          code: 'custom',
          path: [field as string],
          message: `${field as string} is required when ${when}`,
        })
      }
    }

    if (env.AUTH_PROVIDER === 'supabase') {
      require_('SUPABASE_JWKS_URL', "AUTH_PROVIDER='supabase'")
    }

    if (env.STORAGE_PROVIDER === 'local-disk') {
      require_('BLOB_LOCAL_DISK_ROOT', "STORAGE_PROVIDER='local-disk'")
      require_('BLOB_SIGNING_SECRET', "STORAGE_PROVIDER='local-disk'")
      require_('BLOB_PUBLIC_BASE_URL', "STORAGE_PROVIDER='local-disk'")
    }
    if (env.STORAGE_PROVIDER === 'supabase') {
      require_('SUPABASE_URL', "STORAGE_PROVIDER='supabase'")
      require_('SUPABASE_SERVICE_KEY', "STORAGE_PROVIDER='supabase'")
      require_('SUPABASE_STORAGE_BUCKET', "STORAGE_PROVIDER='supabase'")
    }

    switch (env.LLM_PROVIDER) {
      case 'anthropic':
        require_('ANTHROPIC_API_KEY', "LLM_PROVIDER='anthropic'")
        break
      case 'openai':
        require_('OPENAI_API_KEY', "LLM_PROVIDER='openai'")
        break
      case 'openrouter':
        require_('OPENROUTER_API_KEY', "LLM_PROVIDER='openrouter'")
        break
      case 'ollama':
        // No required vars — ollama defaults to http://127.0.0.1:11434.
        break
      default: {
        // Belt + suspenders for the `satisfies` guard above: if
        // `LLMProviderId` widens in adapter-llm and someone forgets to add
        // a case here, TS fails this assignment *and* runtime boot fails
        // loudly rather than silently skipping validation.
        const _exhaustive: never = env.LLM_PROVIDER
        ctx.addIssue({
          code: 'custom',
          path: ['LLM_PROVIDER'],
          message: `unhandled LLM_PROVIDER: ${String(_exhaustive)}`,
        })
      }
    }
  })

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`invalid environment configuration:\n${issues}`)
  }
  return result.data
}
