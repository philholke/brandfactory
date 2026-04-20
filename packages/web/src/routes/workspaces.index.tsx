import { useState } from 'react'
import { createRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Workspace } from '@brandfactory/shared'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { api, AppError, callJson } from '@/api/client'
import { workspaceKeys, useWorkspaces } from '@/api/queries/workspaces'
import { setLastWorkspaceId } from '@/lib/last-workspace'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function NewWorkspaceDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (workspaceName: string) => {
      const res = await api.workspaces.$post({ json: { name: workspaceName } })
      return callJson<Workspace>(res)
    },
    onSuccess: (workspace) => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all() })
      setLastWorkspaceId(workspace.id)
      setOpen(false)
      setName('')
      void navigate({ to: '/workspaces/$wsId', params: { wsId: workspace.id } })
    },
    onError: (err) => {
      toast.error(err instanceof AppError ? err.message : 'Failed to create workspace')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New workspace</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
        </DialogHeader>
        <form
          id="new-workspace-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            mutation.mutate(name.trim())
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-workspace-form"
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate()

  return (
    <button
      className="group rounded-lg border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent"
      onClick={() => {
        setLastWorkspaceId(workspace.id)
        void navigate({ to: '/workspaces/$wsId', params: { wsId: workspace.id } })
      }}
    >
      <div className="font-semibold group-hover:text-accent-foreground">{workspace.name}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Created {new Date(workspace.createdAt).toLocaleDateString()}
      </div>
    </button>
  )
}

function WorkspacesPage() {
  const { data: workspaces, isPending, isError } = useWorkspaces()

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <NewWorkspaceDialog />
      </div>

      {isPending && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {isError && <p className="mt-8 text-sm text-destructive">Failed to load workspaces.</p>}

      {workspaces?.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <p className="text-muted-foreground">No workspaces yet.</p>
          <p className="text-sm text-muted-foreground">
            Create a workspace to start building your brand.
          </p>
        </div>
      )}

      {workspaces && workspaces.length > 0 && (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {workspaces.map((ws) => (
            <WorkspaceCard key={ws.id} workspace={ws} />
          ))}
        </div>
      )}
    </div>
  )
}

export const workspacesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces',
  beforeLoad: () => {
    if (!getAuthToken()) throw redirect({ to: '/login' })
  },
  component: WorkspacesPage,
})
