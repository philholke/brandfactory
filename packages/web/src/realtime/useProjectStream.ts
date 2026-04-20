import { useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentEvent } from '@brandfactory/shared'
import { projectKeys } from '@/api/queries/projects'
import { applyAgentEvent } from './applyAgentEvent'
import { realtimeClient } from './client'
import { useRealtime } from './useRealtime'

// Subscribes to the `project:<id>` realtime channel and applies incoming
// AgentEvents to the React Query cache. Invalidates on WS reconnect so any
// state that drifted during an outage is refetched.
export function useProjectStream(projectId: string): void {
  const qc = useQueryClient()

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      applyAgentEvent(qc, projectId, event)
    },
    [qc, projectId],
  )

  useRealtime(`project:${projectId}`, handleEvent)

  useEffect(() => {
    return realtimeClient.onResynced(() => {
      void qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
    })
  }, [qc, projectId])
}
