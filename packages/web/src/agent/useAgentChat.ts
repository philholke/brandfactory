import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AgentEventSchema, type AgentMessage, type ProjectDetail } from '@brandfactory/shared'
import { getAuthToken, useAuthStore } from '@/auth/store'
import { projectKeys } from '@/api/queries/projects'
import { applyAgentEvent } from '@/realtime/useProjectStream'
import { SseFrameParser } from './sseParser'

export type ChatStatus = 'idle' | 'streaming' | 'error'

export interface UseAgentChatResult {
  status: ChatStatus
  error: string | null
  send: (content: string) => Promise<void>
  stop: () => void
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api') as string

// Posts a user turn to `/projects/:id/agent` and consumes the SSE stream. Each
// AgentEvent is pushed through the same `applyAgentEvent` dispatcher the
// realtime subscription uses, so the canvas and message caches stay in sync
// with no special in-turn state. User messages are appended optimistically
// (the server doesn't echo them on the stream).
export function useAgentChat(projectId: string): UseAgentChatResult {
  const qc = useQueryClient()
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (!trimmed || status === 'streaming') return

      const token = getAuthToken()
      if (!token) return

      const userMessage: AgentMessage = {
        kind: 'message',
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
      }
      qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (old) =>
        old ? { ...old, recentMessages: [...old.recentMessages, userMessage] } : old,
      )

      setError(null)
      setStatus('streaming')
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`${API_BASE}/projects/${projectId}/agent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: { content: trimmed } }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          if (res.status === 401) useAuthStore.getState().logout()
          if (res.status === 409) {
            toast.error('Another turn is running on this project.')
          } else {
            let message = res.statusText
            try {
              const body = (await res.json()) as { message?: string }
              if (body.message) message = body.message
            } catch {
              // non-JSON body — keep statusText
            }
            toast.error(message)
          }
          setStatus('error')
          setError(`${res.status}`)
          return
        }

        const parser = new SseFrameParser()
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let done = false

        while (!done) {
          const chunk = await reader.read()
          if (chunk.done) break
          const text = decoder.decode(chunk.value, { stream: true })
          for (const frame of parser.push(text)) {
            if (frame.event === 'done') {
              done = true
              break
            }
            if (frame.event === 'error') {
              let message = 'Stream error'
              try {
                const body = JSON.parse(frame.data) as { message?: string }
                if (body.message) message = body.message
              } catch {
                // keep default
              }
              setError(message)
              setStatus('error')
              toast.error(message)
              done = true
              break
            }
            try {
              const parsed = AgentEventSchema.parse(JSON.parse(frame.data))
              applyAgentEvent(qc, projectId, parsed)
            } catch {
              // drop unparseable frames — the taxonomy can evolve server-side
              // without breaking the client
            }
          }
        }

        if (status !== 'error') setStatus('idle')
      } catch (err) {
        if (controller.signal.aborted) {
          setStatus('idle')
          return
        }
        const message = err instanceof Error ? err.message : 'Network error'
        setError(message)
        setStatus('error')
        toast.error(message)
      } finally {
        abortRef.current = null
      }
    },
    [projectId, qc, status],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { status, error, send, stop }
}
