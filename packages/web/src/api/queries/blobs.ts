import { useQuery } from '@tanstack/react-query'
import type { BlobReadUrlResponse, BlobUploadResponse } from '@brandfactory/shared'
import { AppError } from '@/api/client'
import { getAuthToken, useAuthStore } from '@/auth/store'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api') as string

// Server signs read URLs for 5 minutes; refresh slightly before to avoid the
// race where an `<img>` mounts with a token that expires mid-request.
const READ_URL_TTL_MS = 5 * 60 * 1000
const READ_URL_REFRESH_MS = 4 * 60 * 1000

export const blobKeys = {
  readUrl: (key: string) => ['blob-read-url', key] as const,
}

// Hono's typed client doesn't round-trip the `:key{.+}` multi-segment regex
// param cleanly (the key contains slashes that need to land in the URL path,
// not be percent-encoded into a single segment). Raw fetch is simpler and
// matches the pattern `useAgentChat` already uses for the streaming endpoint.
async function fetchReadUrl(key: string, signal?: AbortSignal): Promise<string> {
  const token = getAuthToken()
  const res = await fetch(`${API_BASE}/blob-urls/${key}/read-url`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal,
  })
  if (!res.ok) {
    if (res.status === 401) useAuthStore.getState().logout()
    throw new AppError(`Failed to mint read URL (${res.status})`, 'READ_URL_FAILED', res.status)
  }
  const body = (await res.json()) as BlobReadUrlResponse
  return body.url
}

export function useSignedReadUrl(blobKey: string | null | undefined) {
  return useQuery({
    queryKey: blobKeys.readUrl(blobKey ?? ''),
    enabled: !!blobKey,
    staleTime: READ_URL_REFRESH_MS,
    gcTime: READ_URL_TTL_MS,
    refetchInterval: READ_URL_REFRESH_MS,
    queryFn: ({ signal }) => fetchReadUrl(blobKey as string, signal),
  })
}

export interface UploadBlobArgs {
  file: File
}

// Two-step upload: mint a signed write URL, then PUT the bytes directly to
// storage. Returns the storage key the caller passes to the create-block
// mutation. Errors from either step throw `AppError` so callers can toast.
export async function uploadBlob({ file }: UploadBlobArgs): Promise<{ key: string }> {
  const token = getAuthToken()
  const mintRes = await fetch(`${API_BASE}/blob-urls/upload-url`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  })
  if (!mintRes.ok) {
    if (mintRes.status === 401) useAuthStore.getState().logout()
    let message = `Upload failed (${mintRes.status})`
    let code = 'UPLOAD_FAILED'
    try {
      const body = (await mintRes.json()) as { code?: string; message?: string }
      if (body.message) message = body.message
      if (body.code) code = body.code
    } catch {
      // non-JSON body — defaults are fine
    }
    throw new AppError(message, code, mintRes.status)
  }
  const { key, url, headers } = (await mintRes.json()) as BlobUploadResponse

  const putRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      ...(headers ?? {}),
    },
    body: file,
  })
  if (!putRes.ok) {
    throw new AppError(
      `Storage upload failed (${putRes.status})`,
      'STORAGE_PUT_FAILED',
      putRes.status,
    )
  }

  return { key }
}
