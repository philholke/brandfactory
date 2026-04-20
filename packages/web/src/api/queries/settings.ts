import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ResolvedWorkspaceSettings, UpdateWorkspaceSettingsInput } from '@brandfactory/shared'
import { api, callJson } from '@/api/client'

export const settingsKeys = {
  workspace: (wsId: string) => ['workspaces', wsId, 'settings'] as const,
}

export function useWorkspaceSettings(workspaceId: string) {
  return useQuery({
    queryKey: settingsKeys.workspace(workspaceId),
    enabled: !!workspaceId,
    queryFn: async () => {
      const res = await api.workspaces[':id'].settings.$get({ param: { id: workspaceId } })
      return callJson<ResolvedWorkspaceSettings>(res)
    },
  })
}

export function useUpdateWorkspaceSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateWorkspaceSettingsInput) => {
      const res = await api.workspaces[':id'].settings.$patch({
        param: { id: workspaceId },
        json: input,
      })
      return callJson<ResolvedWorkspaceSettings>(res)
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.workspace(workspaceId), data)
    },
  })
}
