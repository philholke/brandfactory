import { describe, expect, it } from 'vitest'
import type {
  CanvasBlock,
  CanvasBlockId,
  CanvasId,
  CanvasOp,
  ImageCanvasBlock,
  FileCanvasBlock,
  TextCanvasBlock,
} from '@brandfactory/shared'
import { CANVAS_CONTEXT_UNPINNED_LIMIT, buildCanvasContext } from './canvas-context'

const ts = '2026-04-19T00:00:00.000Z'

function makeTextBlock(id: string, text: string, position: number): TextCanvasBlock {
  return {
    id: id as CanvasBlockId,
    canvasId: 'c1' as CanvasId,
    kind: 'text',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
    position,
    isPinned: false,
    pinnedAt: null,
    createdBy: 'user',
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

function makeImageBlock(
  id: string,
  position: number,
  opts: { alt?: string; width?: number; height?: number } = {},
): ImageCanvasBlock {
  return {
    id: id as CanvasBlockId,
    canvasId: 'c1' as CanvasId,
    kind: 'image',
    blobKey: `blobs/${id}`,
    alt: opts.alt,
    width: opts.width,
    height: opts.height,
    position,
    isPinned: false,
    pinnedAt: null,
    createdBy: 'user',
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

function makeFileBlock(id: string, position: number): FileCanvasBlock {
  return {
    id: id as CanvasBlockId,
    canvasId: 'c1' as CanvasId,
    kind: 'file',
    blobKey: `blobs/${id}`,
    filename: 'brief.pdf',
    mime: 'application/pdf',
    position,
    isPinned: false,
    pinnedAt: null,
    createdBy: 'user',
    deletedAt: null,
    createdAt: ts,
    updatedAt: ts,
  }
}

describe('buildCanvasContext', () => {
  it('renders an empty canvas with "(none)" placeholders', () => {
    const out = buildCanvasContext({ blocks: [], shortlistBlockIds: [] })
    expect(out).toContain('CANVAS STATE')
    expect(out).toContain('PINNED:')
    expect(out).toContain('UNPINNED:')
    expect(out).toMatch(/PINNED:\n\s+\(none\)/)
    expect(out).toMatch(/UNPINNED:\n\s+\(none\)/)
    expect(out).not.toContain('RECENT OPS:')
  })

  it('splits pinned vs unpinned and summarizes text/image/file', () => {
    const pinnedText = makeTextBlock('blk_pin', 'Pinned tagline idea.', 0)
    const unpinnedImage = makeImageBlock('blk_img', 1, {
      alt: 'moody latte',
      width: 1200,
      height: 800,
    })
    const unpinnedFile = makeFileBlock('blk_file', 2)
    const out = buildCanvasContext({
      blocks: [pinnedText, unpinnedImage, unpinnedFile],
      shortlistBlockIds: ['blk_pin' as CanvasBlockId],
    })
    expect(out).toMatch(/PINNED:\n\s+- blk_pin \[text\] Pinned tagline idea\./)
    expect(out).toContain('blk_img [image: moody latte] (1200×800)')
    expect(out).toContain('blk_file [file: brief.pdf] (application/pdf)')
  })

  it('truncates unpinned beyond the cap and notes the remainder', () => {
    const blocks: CanvasBlock[] = []
    for (let i = 0; i < CANVAS_CONTEXT_UNPINNED_LIMIT + 5; i++) {
      blocks.push(makeTextBlock(`blk_${i}`, `idea ${i}`, i))
    }
    const out = buildCanvasContext({ blocks, shortlistBlockIds: [] })
    expect(out).toContain(`and 5 more`)
    expect(out).toContain('blk_0 [text] idea 0')
    expect(out).toContain(`blk_${CANVAS_CONTEXT_UNPINNED_LIMIT - 1} [text]`)
    expect(out).not.toContain(`blk_${CANVAS_CONTEXT_UNPINNED_LIMIT} [text]`)
  })

  it('renders RECENT OPS when non-empty', () => {
    const addedBlock = makeTextBlock('blk_new', 'fresh', 3)
    const ops: CanvasOp[] = [
      { op: 'add-block', block: addedBlock },
      { op: 'update-block', blockId: 'blk_pin' as CanvasBlockId, patch: { x: 1 } },
      { op: 'remove-block', blockId: 'blk_old' as CanvasBlockId },
    ]
    const out = buildCanvasContext({
      blocks: [],
      shortlistBlockIds: [],
      recentOps: ops,
    })
    expect(out).toContain('RECENT OPS:')
    expect(out).toContain('add-block blk_new')
    expect(out).toContain('update-block blk_pin')
    expect(out).toContain('remove-block blk_old')
  })
})
