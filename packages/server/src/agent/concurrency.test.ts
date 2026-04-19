import { describe, expect, it } from 'vitest'
import type { ProjectId } from '@brandfactory/shared'
import { createAgentConcurrencyGuard } from './concurrency'

const PID = 'p-cc-1' as ProjectId

describe('AgentConcurrencyGuard', () => {
  it('release allows a follow-up acquire on the same project', () => {
    const guard = createAgentConcurrencyGuard()
    const first = guard.acquire(PID)
    expect(first).not.toBeNull()
    first!.release()
    const second = guard.acquire(PID)
    expect(second).not.toBeNull()
  })

  it('a second acquire without release returns null', () => {
    const guard = createAgentConcurrencyGuard()
    expect(guard.acquire(PID)).not.toBeNull()
    expect(guard.acquire(PID)).toBeNull()
  })

  it('release is idempotent — calling twice does not free a different project unexpectedly', () => {
    const guard = createAgentConcurrencyGuard()
    const slot = guard.acquire(PID)!
    slot.release()
    slot.release()
    expect(guard.acquire(PID)).not.toBeNull()
  })
})
