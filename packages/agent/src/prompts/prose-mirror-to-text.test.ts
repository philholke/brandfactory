import { describe, expect, it } from 'vitest'
import type { ProseMirrorDoc } from '@brandfactory/shared'
import { proseMirrorDocToPlainText } from './prose-mirror-to-text'

const doc = (content: unknown[]): ProseMirrorDoc => ({ type: 'doc', content }) as ProseMirrorDoc

describe('proseMirrorDocToPlainText', () => {
  it('flattens a plain paragraph', () => {
    const input = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }])
    expect(proseMirrorDocToPlainText(input)).toBe('Hello world')
  })

  it('separates paragraphs + headings with a blank line', () => {
    const input = doc([
      { type: 'heading', content: [{ type: 'text', text: 'Voice' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Warm and direct.' }] },
    ])
    expect(proseMirrorDocToPlainText(input)).toBe('Voice\n\nWarm and direct.')
  })

  it('renders bullet list items as separate blocks', () => {
    const input = doc([
      {
        type: 'bullet_list',
        content: [
          {
            type: 'list_item',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }],
          },
          {
            type: 'list_item',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }],
          },
        ],
      },
    ])
    expect(proseMirrorDocToPlainText(input)).toBe('First\n\nSecond')
  })

  it('handles nested lists', () => {
    const input = doc([
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Outer' }] },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inner' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
    expect(proseMirrorDocToPlainText(input)).toBe('Outer\n\nInner')
  })

  it('concatenates inline text runs inside a single block', () => {
    const input = doc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
      },
    ])
    expect(proseMirrorDocToPlainText(input)).toBe('Hello world')
  })

  it('returns empty string for an empty doc', () => {
    expect(proseMirrorDocToPlainText(doc([]))).toBe('')
  })
})
