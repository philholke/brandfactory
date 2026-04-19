import { z } from 'zod'

// The route injects `ownerUserId` from the authenticated request, so clients
// only supply the human-editable fields.
export const CreateWorkspaceInputSchema = z.object({
  name: z.string().min(1).max(120),
})

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>
