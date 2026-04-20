import { FileText } from 'lucide-react'
import type { FileCanvasBlock } from '@brandfactory/shared'
import { useSignedReadUrl } from '@/api/queries/blobs'

interface FileBlockViewProps {
  block: FileCanvasBlock
}

export function FileBlockView({ block }: FileBlockViewProps) {
  const { data: url } = useSignedReadUrl(block.blobKey)

  return (
    <div className="flex items-center gap-3 rounded border bg-background p-3">
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{block.filename}</p>
        <p className="text-xs text-muted-foreground">{block.mime}</p>
      </div>
      {url && (
        <a
          href={url}
          download={block.filename}
          className="text-xs text-primary hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Download
        </a>
      )}
    </div>
  )
}
