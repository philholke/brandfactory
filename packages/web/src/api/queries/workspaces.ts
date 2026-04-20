import { useQuery } from '@tanstack/react-query'
import type { Brand, Workspace } from '@brandfactory/shared'
import { api, callJson } from '@/api/client'

export const workspaceKeys = {
  all: () => ['workspaces'] as const,
  detail: (id: string) => ['workspaces', id] as const,
  brands: (wsId: string) => ['workspaces', wsId, 'brands'] as const,
}

export function useWorkspaces(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workspaceKeys.all(),
    enabled: opts?.enabled !== false,
    queryFn: async () => {
      const res = await api.workspaces.$get()
      return callJson<Workspace[]>(res)
    },
  })
}

export function useWorkspace(id: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const res = await api.workspaces[':id'].$get({ param: { id } })
      return callJson<Workspace>(res)
    },
  })
}

export function useWorkspaceBrands(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.brands(workspaceId),
    enabled: !!workspaceId,
    queryFn: async () => {
      const res = await api.workspaces[':workspaceId'].brands.$get({
        param: { workspaceId },
      })
      return callJson<Brand[]>(res)
    },
  })
}
