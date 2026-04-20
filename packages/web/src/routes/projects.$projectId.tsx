import { useMemo, useState } from 'react'
import { createRoute, redirect } from '@tanstack/react-router'
import type { CanvasBlock, CanvasBlockId } from '@brandfactory/shared'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { useProjectDetail } from '@/api/queries/projects'
import { useProjectStream } from '@/realtime/useProjectStream'
import { SplitScreen } from '@/components/project/SplitScreen'
import { TopBar } from '@/components/project/TopBar'
import { ShortlistToggle, type ShortlistMode } from '@/components/project/ShortlistToggle'
import { ChatPane } from '@/components/project/ChatPane'

function CanvasPane({
  blocks,
  shortlistBlockIds,
}: {
  blocks: CanvasBlock[]
  shortlistBlockIds: CanvasBlockId[]
}) {
  const [mode, setMode] = useState<ShortlistMode>('all')

  const shortlistSet = useMemo(() => new Set(shortlistBlockIds), [shortlistBlockIds])
  const visible = useMemo(
    () => (mode === 'shortlist' ? blocks.filter((b) => shortlistSet.has(b.id)) : blocks),
    [mode, blocks, shortlistSet],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <div className="text-sm font-medium">Canvas</div>
        <ShortlistToggle mode={mode} onChange={setMode} shortlistCount={shortlistBlockIds.length} />
      </div>
      <div className="flex-1 overflow-auto p-4 text-sm text-muted-foreground">
        {visible.length === 0 ? (
          <p>
            {mode === 'shortlist'
              ? 'No pinned blocks yet. Pin ideas you want to keep.'
              : 'Canvas is empty. Drop an image or send a message to get started.'}
          </p>
        ) : (
          <p>
            {visible.length} block{visible.length === 1 ? '' : 's'} — renderer lands in Step 12.
          </p>
        )}
      </div>
    </div>
  )
}

function ProjectPage() {
  const { projectId } = projectRoute.useParams()
  const { data, isLoading, error } = useProjectDetail(projectId)

  useProjectStream(projectId)

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading project…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {error instanceof Error ? error.message : 'Project not found.'}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar project={data} brand={data.brand} />
      <SplitScreen
        left={<ChatPane projectId={projectId} messages={data.recentMessages} />}
        right={<CanvasPane blocks={data.blocks} shortlistBlockIds={data.shortlistBlockIds} />}
      />
    </div>
  )
}

export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  beforeLoad: () => {
    if (!getAuthToken()) throw redirect({ to: '/login' })
  },
  component: ProjectPage,
})
