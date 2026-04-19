import { tool, type Tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  CanvasBlockIdSchema,
  ProseMirrorDocSchema,
  type CanvasOpEvent,
  type PinOpEvent,
} from '@brandfactory/shared'
import type { CanvasOpApplier } from './applier'

export type { ToolSet }

// Internal hook used by `streamResponse` to observe each applier result
// alongside its `toolCallId`, so the stream consumer can synthesize
// canvas-op / pin-op events at the right point in the output iterable.
// External callers (Phase 6 server code that just wants the tool set
// for authz introspection) pass no opts; the hook stays undefined.
export interface BuildCanvasToolsOptions {
  onApplied?: (toolCallId: string, event: CanvasOpEvent | PinOpEvent) => void
}

// Tool names the model sees. Kept as exported constants so Phase 6's
// route-level authz / per-tool logging can reference them without
// hard-coding strings.
export const CANVAS_TOOL_NAMES = {
  addCanvasBlock: 'add_canvas_block',
  pinBlock: 'pin_block',
  unpinBlock: 'unpin_block',
} as const

const AddCanvasBlockArgsSchema = z.object({
  body: ProseMirrorDocSchema,
  position: z.number().int(),
})

const PinBlockArgsSchema = z.object({
  blockId: CanvasBlockIdSchema,
})

const UnpinBlockArgsSchema = z.object({
  blockId: CanvasBlockIdSchema,
})

// Factory rather than a const map so the applier is closed over per call,
// not per package. Phase 6 will build a fresh ToolSet per request.
export function buildCanvasTools(
  applier: CanvasOpApplier,
  opts: BuildCanvasToolsOptions = {},
): ToolSet {
  const { onApplied } = opts

  const addCanvasBlock: Tool = tool({
    description:
      'Add a new text block to the canvas. Use this to propose ideas (taglines, outlines, names) the user can react to. Supply the body as a ProseMirror JSON doc.',
    parameters: AddCanvasBlockArgsSchema,
    execute: async (args, execOpts) => {
      const block = await applier.addCanvasBlock({
        kind: 'text',
        body: args.body,
        position: args.position,
      })
      onApplied?.(execOpts.toolCallId, { kind: 'canvas-op', op: { op: 'add-block', block } })
      return { blockId: block.id, isPinned: block.isPinned }
    },
  })

  const pinBlock: Tool = tool({
    description:
      "Pin an existing canvas block — call this to add a block to the user's shortlist of liked ideas.",
    parameters: PinBlockArgsSchema,
    execute: async (args, execOpts) => {
      const block = await applier.pinBlock(args.blockId)
      onApplied?.(execOpts.toolCallId, {
        kind: 'pin-op',
        op: { op: 'pin', blockId: block.id },
      })
      return { blockId: block.id, isPinned: block.isPinned }
    },
  })

  const unpinBlock: Tool = tool({
    description:
      'Unpin a canvas block — remove it from the shortlist. The block itself stays on the canvas.',
    parameters: UnpinBlockArgsSchema,
    execute: async (args, execOpts) => {
      const block = await applier.unpinBlock(args.blockId)
      onApplied?.(execOpts.toolCallId, {
        kind: 'pin-op',
        op: { op: 'unpin', blockId: block.id },
      })
      return { blockId: block.id, isPinned: block.isPinned }
    },
  })

  return {
    [CANVAS_TOOL_NAMES.addCanvasBlock]: addCanvasBlock,
    [CANVAS_TOOL_NAMES.pinBlock]: pinBlock,
    [CANVAS_TOOL_NAMES.unpinBlock]: unpinBlock,
  }
}
