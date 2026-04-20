import { createRoute, redirect } from '@tanstack/react-router'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { useProjectDetail } from '@/api/queries/projects'
import { useProjectStream } from '@/realtime/useProjectStream'
import { SplitScreen } from '@/components/project/SplitScreen'
import { TopBar } from '@/components/project/TopBar'
import { ChatPane } from '@/components/project/ChatPane'
import { CanvasPane } from '@/components/canvas/CanvasPane'

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
        right={
          <CanvasPane
            projectId={data.id}
            blocks={data.blocks}
            shortlistBlockIds={data.shortlistBlockIds}
          />
        }
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
