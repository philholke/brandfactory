import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { AuthBoundary } from '@/auth/AuthBoundary'
import { useAuthStore } from '@/auth/store'
import { useWorkspaces } from '@/api/queries/workspaces'
import { getLastWorkspaceId, setLastWorkspaceId } from '@/lib/last-workspace'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function WorkspacePicker() {
  const token = useAuthStore((s) => s.token)
  const { data: workspaces } = useWorkspaces({ enabled: !!token })
  const navigate = useNavigate()

  if (!token || !workspaces?.length) return null

  const current = getLastWorkspaceId() ?? ''

  return (
    <Select
      value={current}
      onValueChange={(id) => {
        setLastWorkspaceId(id)
        void navigate({ to: '/workspaces/$wsId', params: { wsId: id } })
      }}
    >
      <SelectTrigger className="h-8 w-48 text-sm">
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((ws) => (
          <SelectItem key={ws.id} value={ws.id}>
            {ws.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RootLayout() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4">
        <Link to="/workspaces" className="font-semibold tracking-tight">
          BrandFactory
        </Link>
        <div className="flex-1" />
        <WorkspacePicker />
      </header>
      <main className="flex flex-1 overflow-hidden">
        <AuthBoundary>
          <Outlet />
        </AuthBoundary>
      </main>
      <Toaster />
    </div>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })
