import type { ProjectId } from '@brandfactory/shared'

// One concurrent agent turn per project — two browser tabs on the same
// project would otherwise race the same canvas. Process-local; a horizontally
// scaled deploy needs a Postgres advisory lock keyed on `hashtext(project_id)`
// (see post-Phase-6 hardening list). No queue/wait by design: an explicit 409
// > a hidden delay; the frontend can surface a "another turn is running" toast.
export interface AgentSlot {
  release: () => void
}

export interface AgentConcurrencyGuard {
  acquire(projectId: ProjectId): AgentSlot | null
}

export function createAgentConcurrencyGuard(): AgentConcurrencyGuard {
  const inflight = new Set<ProjectId>()
  return {
    acquire(projectId) {
      if (inflight.has(projectId)) return null
      inflight.add(projectId)
      let released = false
      return {
        release: () => {
          if (released) return
          released = true
          inflight.delete(projectId)
        },
      }
    },
  }
}
