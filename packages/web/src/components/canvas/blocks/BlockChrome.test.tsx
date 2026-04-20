import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { TextCanvasBlock } from '@brandfactory/shared'
import { BlockChrome } from './BlockChrome'

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
    body: { type: 'doc', content: [] },
    ...overrides,
  }
}

describe('BlockChrome', () => {
  it('renders drag handle + pin + delete with accessible labels', () => {
    render(
      <BlockChrome block={textBlock()} onTogglePin={() => undefined} onDelete={() => undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Drag to reorder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pin block' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete block' })).toBeTruthy()
  })

  it('shows "Unpin block" when the block is already pinned', () => {
    render(
      <BlockChrome
        block={textBlock({ isPinned: true })}
        onTogglePin={() => undefined}
        onDelete={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'Unpin block' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pin block' })).toBeNull()
  })

  it('fires onTogglePin / onDelete on click', () => {
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    render(<BlockChrome block={textBlock()} onTogglePin={onTogglePin} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pin block' }))
    expect(onTogglePin).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Delete block' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('disables pin + delete when pending; drag handle stays enabled', () => {
    render(
      <BlockChrome
        block={textBlock()}
        onTogglePin={() => undefined}
        onDelete={() => undefined}
        pending
      />,
    )
    expect((screen.getByRole('button', { name: 'Pin block' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(
      (screen.getByRole('button', { name: 'Delete block' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Drag to reorder' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})
