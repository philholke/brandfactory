import { describe, expect, it, vi } from 'vitest'
import type { CanvasBlockId, CanvasId, ProseMirrorDoc, TextCanvasBlock } from '@brandfactory/shared'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { CanvasOpApplier } from './applier'
import { CANVAS_TOOL_NAMES, buildCanvasTools } from './definitions'

const ts = '2026-04-19T00:00:00.000Z'

function makeBlock(id: string, isPinned: boolean): TextCanvasBlock {
  return {
    id: id as CanvasBlockId,
    canvasId: 'c1' as CanvasId,
    kind: 'text',
    body: { type: 'doc', content: [] } as ProseMirrorDoc,
    position: 0,
    isPinned,
    pinnedAt: isPinned ? ts : null,
    createdBy: 'agent',
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

function makeApplier(): {
  applier: CanvasOpApplier
  addCanvasBlock: ReturnType<typeof vi.fn>
  pinBlock: ReturnType<typeof vi.fn>
  unpinBlock: ReturnType<typeof vi.fn>
} {
  const addCanvasBlock = vi.fn(async () => makeBlock('blk_added', false))
  const pinBlock = vi.fn(async (id: CanvasBlockId) => makeBlock(id, true))
  const unpinBlock = vi.fn(async (id: CanvasBlockId) => makeBlock(id, false))
  return {
    applier: {
      addCanvasBlock: addCanvasBlock as unknown as CanvasOpApplier['addCanvasBlock'],
      pinBlock: pinBlock as unknown as CanvasOpApplier['pinBlock'],
      unpinBlock: unpinBlock as unknown as CanvasOpApplier['unpinBlock'],
    },
    addCanvasBlock,
    pinBlock,
    unpinBlock,
  }
}

const execOpts: ToolExecutionOptions = { toolCallId: 'call_1', messages: [] }

function exec(tool: Tool, args: unknown): Promise<unknown> {
  if (!tool.execute) throw new Error('tool has no execute')
  return Promise.resolve(tool.execute(args, execOpts))
}

describe('buildCanvasTools', () => {
  it('exposes the three v1 canvas tools', () => {
    const { applier } = makeApplier()
    const tools = buildCanvasTools(applier)
    expect(Object.keys(tools).sort()).toEqual(
      [
        CANVAS_TOOL_NAMES.addCanvasBlock,
        CANVAS_TOOL_NAMES.pinBlock,
        CANVAS_TOOL_NAMES.unpinBlock,
      ].sort(),
    )
  })

  it('add_canvas_block forwards body+position and returns compact JSON', async () => {
    const { applier, addCanvasBlock } = makeApplier()
    const tools = buildCanvasTools(applier)
    const body: ProseMirrorDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    }
    const result = (await exec(tools[CANVAS_TOOL_NAMES.addCanvasBlock]!, {
      body,
      position: 3,
    })) as { blockId: string; isPinned: boolean }
    expect(addCanvasBlock).toHaveBeenCalledWith({ kind: 'text', body, position: 3 })
    expect(result).toEqual({ blockId: 'blk_added', isPinned: false })
  })

  it('pin_block calls pinBlock and returns compact JSON', async () => {
    const { applier, pinBlock } = makeApplier()
    const tools = buildCanvasTools(applier)
    const result = (await exec(tools[CANVAS_TOOL_NAMES.pinBlock]!, {
      blockId: 'blk_1',
    })) as { blockId: string; isPinned: boolean }
    expect(pinBlock).toHaveBeenCalledWith('blk_1')
    expect(result).toEqual({ blockId: 'blk_1', isPinned: true })
  })

  it('unpin_block calls unpinBlock and returns compact JSON', async () => {
    const { applier, unpinBlock } = makeApplier()
    const tools = buildCanvasTools(applier)
    const result = (await exec(tools[CANVAS_TOOL_NAMES.unpinBlock]!, {
      blockId: 'blk_2',
    })) as { blockId: string; isPinned: boolean }
    expect(unpinBlock).toHaveBeenCalledWith('blk_2')
    expect(result).toEqual({ blockId: 'blk_2', isPinned: false })
  })

  it('rejects bad input via zod parameters (no applier call)', () => {
    const { applier, addCanvasBlock } = makeApplier()
    const tools = buildCanvasTools(applier)
    const params = tools[CANVAS_TOOL_NAMES.addCanvasBlock]!.parameters as {
      safeParse: (input: unknown) => { success: boolean }
    }
    expect(params.safeParse({ body: { type: 'doc' }, position: 'nope' }).success).toBe(false)
    expect(addCanvasBlock).not.toHaveBeenCalled()
  })
})
