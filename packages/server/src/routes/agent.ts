import { streamResponse } from '@brandfactory/agent'
import type { LLMProvider, LLMProviderSettings } from '@brandfactory/adapter-llm'
import type { RealtimeBus } from '@brandfactory/adapter-realtime'
import {
  PostAgentBodySchema,
  ProjectIdSchema,
  type AgentMessage,
  type BrandWithSections,
  type UserId,
} from '@brandfactory/shared'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createDbRealtimeApplier } from '../agent/applier'
import type { AgentConcurrencyGuard } from '../agent/concurrency'
import { streamResponseToSse } from '../agent/sse'
import { requireProjectAccess } from '../authz'
import type { AppEnv } from '../context'
import type { Db } from '../db'
import type { Env } from '../env'
import { ConflictError, NotFoundError, UnauthorizedError } from '../errors'
import { resolveLLMSettings } from '../settings'

export interface AgentRouteDeps {
  db: Db
  env: Env
  llm: LLMProvider
  realtime: RealtimeBus
  agentGuard: AgentConcurrencyGuard
}

const ProjectParam = z.object({ id: ProjectIdSchema })

export function createAgentRouter(deps: AgentRouteDeps) {
  return new Hono<AppEnv>().post(
    '/:id/agent',
    zValidator('param', ProjectParam),
    zValidator('json', PostAgentBodySchema),
    async (c) => {
      const rawUserId = c.var.userId
      if (!rawUserId) throw new UnauthorizedError()
      // c.var.userId is a plain string set by the auth middleware; brand it
      // here since the persistence + applier surfaces are typed on UserId.
      const userId = rawUserId as UserId
      const { id: projectId } = c.req.valid('param')
      const body = c.req.valid('json')
      const log = c.var.log

      const { project, brand, workspace } = await requireProjectAccess(
        rawUserId,
        projectId,
        deps.db,
      )

      // Per-project, process-local concurrency guard. Two browser tabs on the
      // same project would otherwise race the same canvas. Released by the
      // SSE helper's `onClose`, not the handler's return — Hono hands the
      // Response to node-server which keeps writing.
      const slot = deps.agentGuard.acquire(project.id)
      if (!slot) throw new ConflictError('another turn is running on this project', 'AGENT_BUSY')

      try {
        const resolved = await resolveLLMSettings(workspace.id, deps.env, deps.db)
        const llmSettings: LLMProviderSettings = {
          providerId: resolved.llmProviderId,
          modelId: resolved.llmModel,
        }

        const canvas = await deps.db.getCanvasByProject(project.id)
        if (!canvas) {
          // 1:1 project↔canvas invariant is enforced by createProjectWithCanvas;
          // a missing canvas here is a data-integrity bug, not a normal state.
          log.error('agent route: canvas missing for project', { projectId: project.id })
          throw new NotFoundError('canvas not found', 'CANVAS_NOT_FOUND')
        }

        const [blocks, shortlist, sections, history] = await Promise.all([
          deps.db.listActiveBlocks(canvas.id),
          deps.db.getShortlistView(project.id),
          deps.db.listSectionsByBrand(brand.id),
          deps.db.listAgentMessages(project.id, { limit: 40 }),
        ])
        const brandWithSections: BrandWithSections = { ...brand, sections }

        // Persist the user turn before streaming so a reconnecting client
        // sees it on `listAgentMessages`. The id is server-minted (we ignore
        // body.message.id in v1; Phase 7's frontend can re-key on response).
        const userMessage = await deps.db.appendAgentMessage({
          projectId: project.id,
          role: 'user',
          content: body.message.content,
          userId,
        })

        const applier = createDbRealtimeApplier({
          db: deps.db,
          realtime: deps.realtime,
          projectId: project.id,
          canvasId: canvas.id,
          userId,
          log,
        })

        const messages: AgentMessage[] = [...history, userMessage]

        const events = streamResponse({
          brand: brandWithSections,
          blocks,
          shortlistBlockIds: shortlist.blockIds,
          messages,
          llmProvider: deps.llm,
          llmSettings,
          applier,
          signal: c.req.raw.signal,
        })

        // Accumulator for assistant text, persisted on stream close. A
        // mid-stream failure still persists whatever we have so the user can
        // see what was produced before the break.
        const assistantParts: string[] = []
        let slotReleased = false
        const releaseOnce = () => {
          if (slotReleased) return
          slotReleased = true
          slot.release()
        }

        return streamResponseToSse({
          events,
          signal: c.req.raw.signal,
          log,
          onEvent: (event) => {
            if (event.kind === 'message' && event.role === 'assistant') {
              assistantParts.push(event.content)
            }
            // canvas-op + pin-op events fan out from inside the applier.
            // message + tool-call events fan out here so sibling clients see
            // typing without waiting for the turn to finish.
            if (event.kind === 'message' || event.kind === 'tool-call') {
              void deps.realtime.publish(`project:${project.id}`, event)
            }
          },
          onClose: async () => {
            try {
              const content = assistantParts.join('')
              if (content.length > 0) {
                await deps.db.appendAgentMessage({
                  projectId: project.id,
                  role: 'assistant',
                  content,
                })
              }
            } finally {
              releaseOnce()
            }
          },
        })
      } catch (err) {
        // The SSE helper owns the post-stream slot release; releasing here
        // covers the pre-stream failure paths (resolveLLMSettings, canvas
        // load, user-message persist) where streamResponseToSse never runs.
        slot.release()
        throw err
      }
    },
  )
}
