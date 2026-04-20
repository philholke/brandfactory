import { useCallback, useState } from 'react'
import { createRoute, Link, redirect } from '@tanstack/react-router'
import { useEditor, EditorContent } from '@tiptap/react'
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  BrandGuidelineSection,
  BrandWithSections,
  ProseMirrorDoc,
  SectionId,
  UpdateBrandGuidelinesInput,
} from '@brandfactory/shared'
import { SUGGESTED_SECTIONS } from '@brandfactory/shared'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { AppError } from '@/api/client'
import { useBrand, useUpdateBrandGuidelines } from '@/api/queries/brands'
import { defaultExtensions } from '@/editor/proseMirrorSchema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ---------------------------------------------------------------------------
// Local state model
// ---------------------------------------------------------------------------

type LocalSection = {
  _key: string // stable React key: actual id for persisted, temp uuid for new
  id?: string
  label: string
  body: ProseMirrorDoc
  priority: number
}

const EMPTY_DOC: ProseMirrorDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function toLocal(s: BrandGuidelineSection): LocalSection {
  return { _key: s.id, id: s.id, label: s.label, body: s.body, priority: s.priority }
}

function blankSection(label = ''): LocalSection {
  return { _key: crypto.randomUUID(), label, body: EMPTY_DOC, priority: 0 }
}

// ---------------------------------------------------------------------------
// SectionRow — one editable guideline section
// ---------------------------------------------------------------------------

function SectionRow({
  section,
  onLabelChange,
  onBodyChange,
  onRemove,
}: {
  section: LocalSection
  onLabelChange: (key: string, label: string) => void
  onBodyChange: (key: string, body: ProseMirrorDoc) => void
  onRemove: (key: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section._key,
  })

  const editor = useEditor({
    extensions: defaultExtensions,
    content: section.body as Record<string, unknown>,
    onUpdate: ({ editor: ed }) => {
      onBodyChange(section._key, ed.getJSON() as ProseMirrorDoc)
    },
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex gap-3 rounded-lg border bg-card p-4"
    >
      <button
        type="button"
        className="mt-6 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`label-${section._key}`} className="text-xs text-muted-foreground">
            Label
          </Label>
          <Input
            id={`label-${section._key}`}
            placeholder="e.g. Voice & tone"
            value={section.label}
            onChange={(e) => onLabelChange(section._key, e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="min-h-[80px] rounded border border-input bg-background px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <EditorContent editor={editor} />
        </div>
      </div>

      <button
        type="button"
        className="mt-6 text-muted-foreground hover:text-destructive"
        aria-label="Remove section"
        onClick={() => onRemove(section._key)}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BrandEditorForm — keyed by brand.id so it remounts on brand switch
// ---------------------------------------------------------------------------

function BrandEditorForm({ brand }: { brand: BrandWithSections }) {
  const [sections, setSections] = useState<LocalSection[]>(() => brand.sections.map(toLocal))
  const mutation = useUpdateBrandGuidelines(brand.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleLabelChange = useCallback((key: string, label: string) => {
    setSections((prev) => prev.map((s) => (s._key === key ? { ...s, label } : s)))
  }, [])

  const handleBodyChange = useCallback((key: string, body: ProseMirrorDoc) => {
    setSections((prev) => prev.map((s) => (s._key === key ? { ...s, body } : s)))
  }, [])

  const handleRemove = useCallback((key: string) => {
    setSections((prev) => prev.filter((s) => s._key !== key))
  }, [])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSections((prev) => {
      const oldIdx = prev.findIndex((s) => s._key === String(active.id))
      const newIdx = prev.findIndex((s) => s._key === String(over.id))
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload: UpdateBrandGuidelinesInput = {
      sections: sections.map((s, i) => ({
        ...(s.id !== undefined ? { id: s.id as SectionId } : {}),
        label: s.label,
        body: s.body,
        priority: (i + 1) * 1000,
      })),
    }
    mutation.mutate(payload, {
      onSuccess: (serverSections: BrandGuidelineSection[]) => {
        setSections(serverSections.map(toLocal))
        toast.success('Guidelines saved')
      },
      onError: (err) =>
        toast.error(err instanceof AppError ? err.message : 'Failed to save guidelines'),
    })
  }

  const unusedSuggestions = SUGGESTED_SECTIONS.filter(
    (sg) => !sections.some((s) => s.label === sg.label),
  )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sections.map((s) => s._key)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-3">
            {sections.map((s) => (
              <SectionRow
                key={s._key}
                section={s}
                onLabelChange={handleLabelChange}
                onBodyChange={handleBodyChange}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {sections.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No sections yet. Add one below or pick from suggestions.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setSections((prev) => [...prev, blankSection()])}
      >
        + Add section
      </Button>

      {unusedSuggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Quick-add suggested sections</p>
          <div className="flex flex-wrap gap-2">
            {unusedSuggestions.map((sg) => (
              <button
                key={sg.label}
                type="button"
                title={sg.description}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                onClick={() => setSections((prev) => [...prev, blankSection(sg.label)])}
              >
                {sg.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t pt-4">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save guidelines'}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// BrandEditorPage — route component
// ---------------------------------------------------------------------------

function BrandEditorPage() {
  const { brandId } = brandEditorRoute.useParams()
  const { data: brand, isPending, isError } = useBrand(brandId)

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6">
        {brand ? (
          <Link
            to="/workspaces/$wsId"
            params={{ wsId: brand.workspaceId }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Workspace
          </Link>
        ) : (
          <Link to="/workspaces" className="text-xs text-muted-foreground hover:text-foreground">
            ← Workspaces
          </Link>
        )}
        <h1 className="mt-1 text-2xl font-semibold">{brand?.name ?? '…'}</h1>
        <p className="text-sm text-muted-foreground">Brand guidelines</p>
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load brand.</p>}
      {brand && <BrandEditorForm key={brand.id} brand={brand} />}
    </div>
  )
}

export const brandEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/brands/$brandId',
  beforeLoad: () => {
    if (!getAuthToken()) throw redirect({ to: '/login' })
  },
  component: BrandEditorPage,
})
