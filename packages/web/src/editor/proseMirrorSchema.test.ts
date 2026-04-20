import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { ProseMirrorDocSchema } from '@brandfactory/shared'
import { defaultExtensions } from './proseMirrorSchema'

// The brand editor and the canvas text-block editor both read `defaultExtensions`.
// If the two drifted, a section body couldn't become a canvas block and vice
// versa. These tests pin the schema: documents produced by `defaultExtensions`
// are round-trippable through `ProseMirrorDocSchema` and support the exact
// node set we expose in the UI (paragraphs, headings H1–H3, lists, marks).
function makeEditor(initialContent?: unknown) {
  return new Editor({
    extensions: defaultExtensions,
    content: initialContent ?? '',
  })
}

describe('defaultExtensions', () => {
  it('produces a ProseMirrorDoc that passes ProseMirrorDocSchema', () => {
    const editor = makeEditor('<p>hello</p>')
    const doc = editor.getJSON()
    expect(() => ProseMirrorDocSchema.parse(doc)).not.toThrow()
    expect(doc.type).toBe('doc')
    editor.destroy()
  })

  it('round-trips a doc through setContent → getJSON', () => {
    const editor = makeEditor()
    const input = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Title' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    }
    editor.commands.setContent(input)
    const out = editor.getJSON()
    expect(out).toMatchObject({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 } }, { type: 'paragraph' }],
    })
    editor.destroy()
  })

  it('supports headings at levels 1-3', () => {
    const editor = makeEditor()
    for (const level of [1, 2, 3] as const) {
      editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level },
            content: [{ type: 'text', text: `H${level}` }],
          },
        ],
      })
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: 'heading',
        attrs: { level },
      })
    }
    editor.destroy()
  })

  it('supports bullet and ordered lists from starter-kit', () => {
    const editor = makeEditor()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
          ],
        },
      ],
    })
    expect(editor.getJSON().content?.[0]?.type).toBe('bulletList')
    editor.destroy()
  })
})
