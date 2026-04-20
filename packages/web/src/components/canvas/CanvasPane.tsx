import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  ALLOWED_UPLOAD_MIMES,
  type CanvasBlock,
  type CanvasBlockId,
  type ProjectId,
  type ProseMirrorDoc,
} from '@brandfactory/shared'
import { AppError } from '@/api/client'
import {
  useCreateCanvasBlock,
  useDeleteCanvasBlock,
  usePinCanvasBlock,
  useUnpinCanvasBlock,
  useUpdateCanvasBlock,
} from '@/api/queries/canvas'
import { uploadBlob } from '@/api/queries/blobs'
import { ShortlistToggle, type ShortlistMode } from '@/components/project/ShortlistToggle'
import { Button } from '@/components/ui/button'
import { BlockChrome } from './blocks/BlockChrome'
import { TextBlockView } from './blocks/TextBlockView'
import { ImageBlockView } from './blocks/ImageBlockView'
import { FileBlockView } from './blocks/FileBlockView'

const EMPTY_DOC: ProseMirrorDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

interface CanvasPaneProps {
  projectId: ProjectId
  blocks: CanvasBlock[]
  shortlistBlockIds: CanvasBlockId[]
}

interface SortableBlockProps {
  block: CanvasBlock
  projectId: ProjectId
}

// Wraps one block with sortable behavior + chrome. The TipTap editor inside
// `TextBlockView` is the entire row's click surface; `BlockChrome` keeps the
// drag handle as the only `useSortable` listener attachment so clicking into
// text doesn't start a drag (PointerSensor's 8px constraint isn't enough).
function SortableBlock({ block, projectId }: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })

  const updateMut = useUpdateCanvasBlock(projectId)
  const pinMut = usePinCanvasBlock(projectId)
  const unpinMut = useUnpinCanvasBlock(projectId)
  const deleteMut = useDeleteCanvasBlock(projectId)

  const handleTextChange = useCallback(
    (body: ProseMirrorDoc) => {
      updateMut.mutate(
        { blockId: block.id, patch: { body } },
        {
          onError: (err) =>
            toast.error(err instanceof AppError ? err.message : 'Failed to save block'),
        },
      )
    },
    [block.id, updateMut],
  )

  const handleAltChange = useCallback(
    (alt: string) => {
      updateMut.mutate(
        { blockId: block.id, patch: { alt: alt || null } },
        {
          onError: (err) =>
            toast.error(err instanceof AppError ? err.message : 'Failed to save alt text'),
        },
      )
    },
    [block.id, updateMut],
  )

  const handleTogglePin = () => {
    const mut = block.isPinned ? unpinMut : pinMut
    mut.mutate(block.id, {
      onError: (err) => toast.error(err instanceof AppError ? err.message : 'Failed to update pin'),
    })
  }

  const handleDelete = () => {
    deleteMut.mutate(block.id, {
      onError: (err) =>
        toast.error(err instanceof AppError ? err.message : 'Failed to delete block'),
    })
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="group flex gap-2 rounded-lg border bg-card p-3"
    >
      <BlockChrome
        block={block}
        dragAttributes={attributes as React.HTMLAttributes<HTMLButtonElement>}
        dragListeners={listeners as Record<string, (e: unknown) => void>}
        onTogglePin={handleTogglePin}
        onDelete={handleDelete}
        pending={pinMut.isPending || unpinMut.isPending || deleteMut.isPending}
      />
      <div className="flex-1 overflow-hidden">
        {block.kind === 'text' && <TextBlockView block={block} onChange={handleTextChange} />}
        {block.kind === 'image' && <ImageBlockView block={block} onAltChange={handleAltChange} />}
        {block.kind === 'file' && <FileBlockView block={block} />}
      </div>
    </div>
  )
}

// Compute a sparse-integer position for a block being inserted at `newIndex`
// inside `ordered`. Sandwich between neighbors when both exist; bookend by
// ±1000 otherwise. This stays an `integer` (canvas_blocks.position is int4)
// for many reorders before needing a server-side rebalance.
function positionAt(ordered: CanvasBlock[], newIndex: number, movingId: CanvasBlockId): number {
  const without = ordered.filter((b) => b.id !== movingId)
  const before = without[newIndex - 1]
  const after = without[newIndex]
  if (before && after) return Math.floor((before.position + after.position) / 2)
  if (before) return before.position + 1000
  if (after) return after.position - 1000
  return 1000
}

export function CanvasPane({ projectId, blocks, shortlistBlockIds }: CanvasPaneProps) {
  const [mode, setMode] = useState<ShortlistMode>('all')
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  const createMut = useCreateCanvasBlock(projectId)
  const updateMut = useUpdateCanvasBlock(projectId)

  const sortedBlocks = useMemo(() => [...blocks].sort((a, b) => a.position - b.position), [blocks])

  const shortlistSet = useMemo(() => new Set(shortlistBlockIds), [shortlistBlockIds])
  const visible = useMemo(
    () =>
      mode === 'shortlist' ? sortedBlocks.filter((b) => shortlistSet.has(b.id)) : sortedBlocks,
    [mode, sortedBlocks, shortlistSet],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const newIndex = sortedBlocks.findIndex((b) => b.id === over.id)
    if (newIndex < 0) return
    const movingId = active.id as CanvasBlockId
    const position = positionAt(sortedBlocks, newIndex, movingId)
    updateMut.mutate(
      { blockId: movingId, patch: { position } },
      {
        onError: (err) => toast.error(err instanceof AppError ? err.message : 'Failed to reorder'),
      },
    )
  }

  function handleAddText() {
    createMut.mutate(
      { kind: 'text', body: EMPTY_DOC },
      {
        onError: (err) =>
          toast.error(err instanceof AppError ? err.message : 'Failed to create block'),
      },
    )
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setUploading((n) => n + list.length)
      for (const file of list) {
        try {
          if (!(ALLOWED_UPLOAD_MIMES as readonly string[]).includes(file.type)) {
            toast.error(`Unsupported file type: ${file.type || file.name}`)
            continue
          }
          const { key } = await uploadBlob({ file })
          if (file.type.startsWith('image/')) {
            await createMut.mutateAsync({ kind: 'image', blobKey: key, alt: file.name })
          } else {
            await createMut.mutateAsync({
              kind: 'file',
              blobKey: key,
              filename: file.name,
              mime: file.type || 'application/octet-stream',
            })
          }
        } catch (err) {
          toast.error(err instanceof AppError ? err.message : `Upload failed: ${file.name}`)
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [createMut],
  )

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files)
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
        }
      }}
      onDragLeave={(e) => {
        // Only clear if leaving the pane itself, not a child element.
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between border-b p-3">
        <div className="text-sm font-medium">Canvas</div>
        <ShortlistToggle mode={mode} onChange={setMode} shortlistCount={shortlistBlockIds.length} />
      </div>

      <div
        className={
          dragOver
            ? 'flex-1 overflow-auto bg-primary/5 p-4 outline outline-2 outline-dashed outline-primary'
            : 'flex-1 overflow-auto p-4'
        }
      >
        {visible.length === 0 && uploading === 0 ? (
          <p className="text-sm text-muted-foreground">
            {mode === 'shortlist'
              ? 'No pinned blocks yet. Pin ideas you want to keep.'
              : 'Canvas is empty. Drop a file, or click + to add a text block.'}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={visible.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-3">
                {visible.map((block) => (
                  <SortableBlock key={block.id} block={block} projectId={projectId} />
                ))}
                {Array.from({ length: uploading }).map((_, i) => (
                  <div
                    key={`upload-${i}`}
                    className="h-20 animate-pulse rounded-lg border bg-muted/40"
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddText}
            disabled={createMut.isPending}
          >
            <Plus className="mr-1 h-4 w-4" />
            Text block
          </Button>
        </div>
      </div>
    </div>
  )
}
