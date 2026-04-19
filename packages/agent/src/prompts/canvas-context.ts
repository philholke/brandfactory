import type { CanvasBlock, CanvasBlockId, CanvasOp } from '@brandfactory/shared'
import { proseMirrorDocToPlainText } from './prose-mirror-to-text'

// Cap on how many unpinned blocks we render into the prompt. Exported so
// it's easy to re-tune (swap for a character-budget truncator later — see
// Phase 5 plan follow-ups).
export const CANVAS_CONTEXT_UNPINNED_LIMIT = 20

// Cap on the per-block summary for text blocks. Cheap character budget;
// revisit alongside the unpinned-limit when we see real prompts.
const TEXT_SUMMARY_MAX_CHARS = 200

export interface BuildCanvasContextInput {
  blocks: CanvasBlock[] // active blocks, asc position
  shortlistBlockIds: CanvasBlockId[]
  recentOps?: CanvasOp[] // optional — Phase 6 will populate
}

// Builds the CANVAS STATE block appended to the system prompt. Deterministic,
// side-effect-free, tests pin the structural shape.
export function buildCanvasContext(input: BuildCanvasContextInput): string {
  const { blocks, shortlistBlockIds, recentOps } = input

  const pinnedSet = new Set<string>(shortlistBlockIds)
  const pinned: CanvasBlock[] = []
  const unpinned: CanvasBlock[] = []
  for (const block of blocks) {
    if (pinnedSet.has(block.id)) pinned.push(block)
    else unpinned.push(block)
  }

  const lines: string[] = ['CANVAS STATE', '']

  lines.push('PINNED:')
  if (pinned.length === 0) {
    lines.push('  (none)')
  } else {
    for (const block of pinned) lines.push(`  - ${summarizeBlock(block)}`)
  }
  lines.push('')

  lines.push('UNPINNED:')
  if (unpinned.length === 0) {
    lines.push('  (none)')
  } else {
    const shown = unpinned.slice(0, CANVAS_CONTEXT_UNPINNED_LIMIT)
    for (const block of shown) lines.push(`  - ${summarizeBlock(block)}`)
    const remaining = unpinned.length - shown.length
    if (remaining > 0) lines.push(`  … and ${remaining} more`)
  }

  if (recentOps && recentOps.length > 0) {
    lines.push('')
    lines.push('RECENT OPS:')
    for (const op of recentOps) lines.push(`  - ${summarizeOp(op)}`)
  }

  return lines.join('\n')
}

function summarizeBlock(block: CanvasBlock): string {
  switch (block.kind) {
    case 'text': {
      const plain = proseMirrorDocToPlainText(block.body).replace(/\s+/g, ' ').trim()
      const truncated =
        plain.length > TEXT_SUMMARY_MAX_CHARS ? plain.slice(0, TEXT_SUMMARY_MAX_CHARS) + '…' : plain
      return `${block.id} [text] ${truncated || '(empty)'}`
    }
    case 'image': {
      const alt = block.alt && block.alt.length > 0 ? block.alt : 'untitled'
      const dims =
        block.width !== undefined && block.height !== undefined
          ? ` (${block.width}×${block.height})`
          : ''
      return `${block.id} [image: ${alt}]${dims}`
    }
    case 'file': {
      return `${block.id} [file: ${block.filename}] (${block.mime})`
    }
  }
}

function summarizeOp(op: CanvasOp): string {
  switch (op.op) {
    case 'add-block':
      return `add-block ${op.block.id}`
    case 'update-block':
      return `update-block ${op.blockId}`
    case 'remove-block':
      return `remove-block ${op.blockId}`
  }
}
