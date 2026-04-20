import { createRouter } from '@tanstack/react-router'
import { rootRoute } from '@/routes/__root'
import { indexRoute } from '@/routes/index'
import { loginRoute } from '@/routes/login'
import { workspacesIndexRoute } from '@/routes/workspaces.index'
import { workspaceDetailRoute } from '@/routes/workspaces.$wsId.index'
import { workspaceSettingsRoute } from '@/routes/workspaces.$wsId.settings'
import { brandEditorRoute } from '@/routes/brands.$brandId'
import { projectRoute } from '@/routes/projects.$projectId'

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  workspacesIndexRoute,
  workspaceDetailRoute,
  workspaceSettingsRoute,
  brandEditorRoute,
  projectRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
