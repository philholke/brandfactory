import { useQuery } from '@tanstack/react-query'
import type { AgentMessage, CanvasBlock, ProjectDetail } from '@brandfactory/shared'
import { api, callJson } from '@/api/client'

export const projectKeys = {
  detail: (id: string) => ['projects', id] as const,
  blocks: (id: string) => ['projects', id, 'blocks'] as const,
  messages: (id: string) => ['projects', id, 'messages'] as const,
  shortlist: (id: string) => ['projects', id, 'shortlist'] as const,
}

export function useProjectDetail(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const res = await api.projects[':id'].$get({ param: { id } })
      return callJson<ProjectDetail>(res)
    },
  })
}

export function useProjectBlocks(id: string) {
  return useQuery({
    queryKey: projectKeys.blocks(id),
    enabled: !!id,
    queryFn: async () => {
      const res = await api.projects[':id']['canvas']['blocks'].$get({ param: { id } })
      return callJson<CanvasBlock[]>(res)
    },
  })
}

export function useProjectMessages(id: string, limit?: number) {
  return useQuery({
    queryKey: projectKeys.messages(id),
    enabled: !!id,
    queryFn: async () => {
      const res = await api.projects[':id'].messages.$get({
        param: { id },
        query: limit !== undefined ? { limit: String(limit) } : {},
      })
      return callJson<AgentMessage[]>(res)
    },
  })
}
