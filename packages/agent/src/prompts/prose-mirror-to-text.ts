import type { ProseMirrorDoc } from '@brandfactory/shared'

// Walk a ProseMirror / TipTap JSON doc and flatten it to plain text.
// Deliberately lossy — this is LLM context, not a faithful rendering.
// Every block-level node (paragraph, heading, list_item, blockquote,
// code block, …) becomes its own block; text nodes concatenate into
// the block currently being built.
export function proseMirrorDocToPlainText(doc: ProseMirrorDoc): string {
  const blocks: string[] = []
  const state = { current: '' }
  walk(doc, blocks, state)
  flush(blocks, state)
  return blocks.join('\n\n').trim()
}

type PMNode = { type?: unknown; text?: unknown; content?: unknown }

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'code_block',
  'codeBlock',
  'list_item',
  'listItem',
  'bullet_list',
  'bulletList',
  'ordered_list',
  'orderedList',
  'horizontal_rule',
  'horizontalRule',
])

function walk(node: unknown, blocks: string[], state: { current: string }): void {
  if (node === null || typeof node !== 'object') return
  const n = node as PMNode
  if (typeof n.text === 'string') {
    state.current += n.text
    return
  }
  const type = typeof n.type === 'string' ? n.type : ''
  const isBlock = BLOCK_TYPES.has(type)
  if (isBlock) flush(blocks, state)
  if (Array.isArray(n.content)) {
    for (const child of n.content) walk(child, blocks, state)
  }
  if (isBlock) flush(blocks, state)
}

function flush(blocks: string[], state: { current: string }): void {
  if (state.current.length > 0) {
    blocks.push(state.current)
    state.current = ''
  }
}
