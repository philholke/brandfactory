/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_PROVIDER: string | undefined
  readonly VITE_SUPABASE_URL: string | undefined
  readonly VITE_SUPABASE_ANON_KEY: string | undefined
  readonly VITE_API_BASE_URL: string | undefined
  readonly VITE_RT_URL: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
