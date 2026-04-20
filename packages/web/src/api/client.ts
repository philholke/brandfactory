import { QueryClient } from '@tanstack/react-query'
import { hc } from 'hono/client'
import type { AppType } from '@brandfactory/server'
import { getAuthToken, useAuthStore } from '@/auth/store'

export class AppError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
  }
}

// Wraps a hono/client response: returns parsed JSON on 2xx, throws AppError on
// non-2xx. On 401 it also triggers an auth logout so the router redirects.
export async function callJson<T>(res: Response): Promise<T> {
  if (res.ok) {
    return res.json() as Promise<T>
  }
  let code = 'UNKNOWN'
  let message = res.statusText
  try {
    const body = (await res.json()) as { code?: string; message?: string }
    if (body.code) code = body.code
    if (body.message) message = body.message
  } catch {
    // body wasn't JSON — defaults are fine
  }
  if (res.status === 401) {
    useAuthStore.getState().logout()
  }
  throw new AppError(message, code, res.status)
}

// Singleton typed API client. Headers callback reads the token on each call so
// the client does not need to be re-created after login/logout.
export const api = hc<AppType>(import.meta.env.VITE_API_BASE_URL ?? '/api', {
  headers: (): Record<string, string> => {
    const token = getAuthToken()
    return token ? { authorization: `Bearer ${token}` } : {}
  },
})

export type ApiClient = typeof api

// Singleton QueryClient shared by main.tsx (for QueryClientProvider) and route
// loaders (via direct import). Don't retry on 4xx — those are user errors, not
// transient failures.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof AppError && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})
