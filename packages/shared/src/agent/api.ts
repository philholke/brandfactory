import { z } from 'zod'

// Wire schema for `POST /projects/:id/agent`. Lives in shared so the
// frontend (Phase 7) can reuse the exact same parser. The id is optional —
// the server mints one if absent so a vanilla `useChat` call without a
// pre-allocated id still works. The 8 000-char ceiling is a sanity bound,
// not a token budget; the agent layer applies its own context-window trim
// in a later phase.
export const PostAgentBodySchema = z.object({
  message: z.object({
    id: z.string().min(1).optional(),
    content: z.string().min(1).max(8_000),
  }),
})

export type PostAgentBody = z.infer<typeof PostAgentBodySchema>
