import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { ProseMirrorDoc, TextCanvasBlock } from '@brandfactory/shared'
import { defaultExtensions } from '@/editor/proseMirrorSchema'

interface TextBlockViewProps {
  block: TextCanvasBlock
  onChange: (body: ProseMirrorDoc) => void
}

const SAVE_DEBOUNCE_MS = 500

// TipTap editor for a text block. Mounts once with the server's body; outbound
// edits are debounced (`SAVE_DEBOUNCE_MS`) and emitted via `onChange`. We
// intentionally do **not** sync inbound updates back into the editor — for v1
// the canvas is last-write-wins per block (see Phase-7 plan non-goals); a
// realtime echo of someone else's edit is dropped on the canvas pane until the
// user re-opens the project.
export function TextBlockView({ block, onChange }: TextBlockViewProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: defaultExtensions,
    content: block.body as Record<string, unknown>,
    onUpdate: ({ editor: ed }) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        onChange(ed.getJSON() as ProseMirrorDoc)
      }, SAVE_DEBOUNCE_MS)
    },
  })

  // Flush pending edits on blur and unmount so a quick navigate-away doesn't
  // lose the last keystrokes.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        if (editor && !editor.isDestroyed) {
          onChange(editor.getJSON() as ProseMirrorDoc)
        }
      }
    }
  }, [editor, onChange])

  return (
    <div className="min-h-[60px] rounded border border-input bg-background px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <EditorContent editor={editor} />
    </div>
  )
}
