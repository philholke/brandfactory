import StarterKit from '@tiptap/starter-kit'
import type { Extensions } from '@tiptap/core'

// Shared TipTap extension set used by both the brand guideline editor (Step 9)
// and the canvas text-block editor (Step 11). Keeping them identical means a
// section body can be promoted to a canvas block and vice versa.
export const defaultExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
]
