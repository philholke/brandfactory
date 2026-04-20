import { useEffect } from 'react'
import type { AgentEvent } from '@brandfactory/shared'
import { realtimeClient } from './client'

// Subscribes to a realtime channel and calls `handler` on each incoming event.
// Callers must stabilise `handler` with `useCallback` to avoid subscribe/
// unsubscribe churn on every render.
export function useRealtime(channel: string, handler: (payload: AgentEvent) => void): void {
  useEffect(() => {
    return realtimeClient.subscribe(channel, handler)
  }, [channel, handler])
}
