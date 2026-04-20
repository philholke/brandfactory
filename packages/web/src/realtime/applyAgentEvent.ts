import type { QueryClient } from '@tanstack/react-query'
import type { AgentEvent, CanvasBlock, ProjectDetail } from '@brandfactory/shared'
import { projectKeys } from '@/api/queries/projects'

// Single dispatcher that folds an AgentEvent into the React Query caches for
// a project. Called from both entry points — the realtime WS subscription
// (useProjectStream) and the SSE streaming turn (useAgentChat) — so canvas,
// shortlist, and message state stay bit-identical regardless of which
// transport delivered the event. Each caller is responsible for validating
// the wire payload against AgentEventSchema at its own boundary; this
// function trusts its argument.
export function applyAgentEvent(qc: QueryClient, projectId: string, event: AgentEvent): void {
  switch (event.kind) {
    case 'canvas-op': {
      const { op } = event
      if (op.op === 'add-block') {
        const block = op.block
        qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (old) => {
          if (!old || old.blocks.some((b) => b.id === block.id)) return old
          return { ...old, blocks: [...old.blocks, block] }
        })
        qc.setQueryData<CanvasBlock[]>(projectKeys.blocks(projectId), (old) => {
          if (!old || old.some((b) => b.id === block.id)) return old
          return [...old, block]
        })
      } else if (op.op === 'update-block') {
        // op.patch is JsonValue — the server emits the valid partial block
        // shape after Zod validation; we trust it and spread directly.
        const patch = op.patch as unknown as Partial<CanvasBlock>
        qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (old) => {
          if (!old) return old
          return {
            ...old,
            blocks: old.blocks.map((b) =>
              b.id === op.blockId ? ({ ...b, ...patch } as CanvasBlock) : b,
            ),
          }
        })
        qc.setQueryData<CanvasBlock[]>(projectKeys.blocks(projectId), (old) => {
          if (!old) return old
          return old.map((b) => (b.id === op.blockId ? ({ ...b, ...patch } as CanvasBlock) : b))
        })
      } else if (op.op === 'remove-block') {
        qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (old) => {
          if (!old) return old
          return { ...old, blocks: old.blocks.filter((b) => b.id !== op.blockId) }
        })
        qc.setQueryData<CanvasBlock[]>(projectKeys.blocks(projectId), (old) => {
          if (!old) return old
          return old.filter((b) => b.id !== op.blockId)
        })
      }
      break
    }

    case 'pin-op': {
      const { op } = event
      const pinned = op.op === 'pin'
      qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (old) => {
        if (!old) return old
        return {
          ...old,
          blocks: old.blocks.map((b) => (b.id === op.blockId ? { ...b, isPinned: pinned } : b)),
          shortlistBlockIds: pinned
            ? old.shortlistBlockIds.includes(op.blockId)
              ? old.shortlistBlockIds
              : [...old.shortlistBlockIds, op.blockId]
            : old.shortlistBlockIds.filter((id) => id !== op.blockId),
        }
      })
      qc.setQueryData<CanvasBlock[]>(projectKeys.blocks(projectId), (old) => {
        if (!old) return old
        return old.map((b) => (b.id === op.blockId ? { ...b, isPinned: pinned } : b))
      })
      break
    }

    case 'message': {
      qc.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (old) => {
        if (!old || old.recentMessages.some((m) => m.id === event.id)) return old
        return { ...old, recentMessages: [...old.recentMessages, event] }
      })
      break
    }

    case 'tool-call':
      // Tool-call frames carry no cache state — they render in the chat pane only.
      break
  }
}
