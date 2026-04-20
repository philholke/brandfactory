import { useState } from 'react'
import type { ImageCanvasBlock } from '@brandfactory/shared'
import { useSignedReadUrl } from '@/api/queries/blobs'
import { Input } from '@/components/ui/input'

interface ImageBlockViewProps {
  block: ImageCanvasBlock
  onAltChange: (alt: string) => void
}

export function ImageBlockView({ block, onAltChange }: ImageBlockViewProps) {
  const { data: url, isPending, isError } = useSignedReadUrl(block.blobKey)
  const [lightbox, setLightbox] = useState(false)
  const [draftAlt, setDraftAlt] = useState(block.alt ?? '')

  return (
    <div className="flex flex-col gap-2">
      {isPending && (
        <div className="flex h-40 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
          Loading image…
        </div>
      )}
      {isError && (
        <div className="flex h-40 items-center justify-center rounded bg-muted text-xs text-destructive">
          Failed to load image
        </div>
      )}
      {url && (
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="overflow-hidden rounded border bg-background"
        >
          <img src={url} alt={block.alt ?? ''} className="block max-h-96 w-full object-contain" />
        </button>
      )}
      <Input
        value={draftAlt}
        onChange={(e) => setDraftAlt(e.target.value)}
        onBlur={() => {
          if (draftAlt !== (block.alt ?? '')) onAltChange(draftAlt)
        }}
        placeholder="Alt text (optional)"
        className="h-7 text-xs"
      />

      {lightbox && url && (
        <button
          type="button"
          aria-label="Close image preview"
          onClick={() => setLightbox(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
        >
          <img src={url} alt={block.alt ?? ''} className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </div>
  )
}
