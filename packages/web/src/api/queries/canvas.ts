import { useMutation } from '@tanstack/react-query'
import type {
  CanvasBlock,
  CanvasBlockId,
  CreateCanvasBlockInput,
  ProjectId,
  UpdateCanvasBlockInput,
} from '@brandfactory/shared'
import { api, callJson } from '@/api/client'

// All canvas mutations are non-optimistic for v1: the server publishes the
// matching realtime event after each DB write, and `applyAgentEvent` (via
// `useProjectStream`) writes it into the React Query cache. The mutation's
// returned block is therefore advisory — the cache will reflect the same data
// within a round-trip on the realtime channel.

export function useCreateCanvasBlock(projectId: ProjectId) {
  return useMutation({
    mutationFn: async (input: CreateCanvasBlockInput) => {
      const res = await api.projects[':id'].canvas.blocks.$post({
        param: { id: projectId },
        json: input,
      })
      return callJson<CanvasBlock>(res)
    },
  })
}

export function useUpdateCanvasBlock(projectId: ProjectId) {
  return useMutation({
    mutationFn: async (args: { blockId: CanvasBlockId; patch: UpdateCanvasBlockInput }) => {
      const res = await api.projects[':id'].canvas.blocks[':blockId'].$patch({
        param: { id: projectId, blockId: args.blockId },
        json: args.patch,
      })
      return callJson<CanvasBlock>(res)
    },
  })
}

export function usePinCanvasBlock(projectId: ProjectId) {
  return useMutation({
    mutationFn: async (blockId: CanvasBlockId) => {
      const res = await api.projects[':id'].canvas.blocks[':blockId'].pin.$post({
        param: { id: projectId, blockId },
      })
      return callJson<CanvasBlock>(res)
    },
  })
}

export function useUnpinCanvasBlock(projectId: ProjectId) {
  return useMutation({
    mutationFn: async (blockId: CanvasBlockId) => {
      const res = await api.projects[':id'].canvas.blocks[':blockId'].unpin.$post({
        param: { id: projectId, blockId },
      })
      return callJson<CanvasBlock>(res)
    },
  })
}

export function useDeleteCanvasBlock(projectId: ProjectId) {
  return useMutation({
    mutationFn: async (blockId: CanvasBlockId) => {
      const res = await api.projects[':id'].canvas.blocks[':blockId'].$delete({
        param: { id: projectId, blockId },
      })
      if (!res.ok) await callJson<unknown>(res)
    },
  })
}
