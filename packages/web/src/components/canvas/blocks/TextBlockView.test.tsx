import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TextCanvasBlock } from '@brandfactory/shared'
import { TextBlockView } from './TextBlockView'

function textBlock(overrides: Partial<TextCanvasBlock> = {}): TextCanvasBlock {
  return {
    kind: 'text',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as TextCanvasBlock['id'],
    canvasId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as TextCanvasBlock['canvasId'],
    position: 1000,
    isPinned: false,
    pinnedAt: null,
    createdBy: 'user',
    deletedAt: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'initial body' }] }],
    },
    ...overrides,
  }
}

describe('TextBlockView', () => {
  it('mounts with the block body', () => {
    render(<TextBlockView block={textBlock()} onChange={() => undefined} />)
    expect(screen.getByText('initial body')).toBeTruthy()
  })

  it('renders a contenteditable surface', () => {
    const { container } = render(<TextBlockView block={textBlock()} onChange={() => undefined} />)
    // TipTap mounts a ProseMirror contenteditable element inside EditorContent.
    const editable = container.querySelector('[contenteditable="true"]')
    expect(editable).not.toBeNull()
  })
})
