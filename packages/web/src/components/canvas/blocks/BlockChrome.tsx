import { GripVertical, Star, Trash2 } from 'lucide-react'
import type { CanvasBlock } from '@brandfactory/shared'

interface BlockChromeProps {
  block: CanvasBlock
  dragAttributes?: React.HTMLAttributes<HTMLButtonElement>
  dragListeners?: Record<string, (e: unknown) => void>
  onTogglePin: () => void
  onDelete: () => void
  pending?: boolean
}

// Hover-revealed left rail: drag handle + pin/delete buttons. The drag handle
// must be the only drag activator (PointerSensor's 8px constraint isn't enough
// to disambiguate a click on the TipTap editor inside a block).
export function BlockChrome({
  block,
  dragAttributes,
  dragListeners,
  onTogglePin,
  onDelete,
  pending,
}: BlockChromeProps) {
  return (
    <div className="flex flex-col items-center gap-1 pt-2 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab touch-none p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...dragAttributes}
        {...dragListeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={block.isPinned ? 'Unpin block' : 'Pin block'}
        onClick={onTogglePin}
        disabled={pending}
        className={
          block.isPinned
            ? 'p-1 text-amber-500 hover:text-amber-600'
            : 'p-1 text-muted-foreground hover:text-amber-500'
        }
      >
        <Star className={block.isPinned ? 'h-4 w-4 fill-current' : 'h-4 w-4'} />
      </button>
      <button
        type="button"
        aria-label="Delete block"
        onClick={onDelete}
        disabled={pending}
        className="p-1 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
