import type { AgentMessage, ProjectId, UserId } from '@brandfactory/shared'
import { asc, desc, eq } from 'drizzle-orm'
import { db } from '../client'
import { rowToAgentMessage } from '../mappers'
import { agentMessages } from '../schema'

export interface AppendAgentMessageInput {
  projectId: ProjectId
  role: 'user' | 'assistant'
  content: string
  userId?: UserId | null
}

export async function appendAgentMessage(input: AppendAgentMessageInput): Promise<AgentMessage> {
  const [row] = await db
    .insert(agentMessages)
    .values({
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      userId: input.userId ?? null,
    })
    .returning()
  if (!row) throw new Error('appendAgentMessage returned no row')
  return rowToAgentMessage(row)
}

// Oldest-first order (what `streamText` expects). Limit picks the latest N
// via a subquery DESC then re-orders the result set ASC so chronology is
// preserved after trimming.
export async function listAgentMessages(
  projectId: ProjectId,
  opts: { limit?: number } = {},
): Promise<AgentMessage[]> {
  const limit = opts.limit ?? 40
  const latest = db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.projectId, projectId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit)
    .as('latest')
  const rows = await db.select().from(latest).orderBy(asc(latest.createdAt))
  return rows.map((row) =>
    rowToAgentMessage({
      id: row.id,
      projectId: row.projectId,
      role: row.role,
      content: row.content,
      userId: row.userId,
      createdAt: row.createdAt,
    }),
  )
}
