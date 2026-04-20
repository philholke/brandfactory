import { createRoute, redirect } from '@tanstack/react-router'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    if (!getAuthToken()) throw redirect({ to: '/login' })
    throw redirect({ to: '/workspaces' })
  },
})
