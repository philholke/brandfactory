import { useEffect, useState } from 'react'
import { createRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Brand } from '@brandfactory/shared'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { api, AppError, callJson } from '@/api/client'
import { workspaceKeys, useWorkspace, useWorkspaceBrands } from '@/api/queries/workspaces'
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

function NewBrandDialog({ wsId }: { wsId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await api.workspaces[':workspaceId'].brands.$post({
        param: { workspaceId: wsId },
        json: data,
      })
      return callJson<Brand>(res)
    },
    onSuccess: (brand) => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.brands(wsId) })
      setOpen(false)
      setName('')
      setDescription('')
      void navigate({ to: '/brands/$brandId', params: { brandId: brand.id } })
    },
    onError: (err) => {
      toast.error(err instanceof AppError ? err.message : 'Failed to create brand')
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New brand</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
        </DialogHeader>
        <form
          id="new-brand-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            mutation.mutate({
              name: name.trim(),
              ...(description.trim() ? { description: description.trim() } : {}),
            })
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-name">Name</Label>
            <Input
              id="brand-name"
              placeholder="Acme"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-description">Description (optional)</Label>
            <Input
              id="brand-description"
              placeholder="What this brand is about"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-brand-form" disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BrandCard({ brand }: { brand: Brand }) {
  const navigate = useNavigate()

  return (
    <button
      className="group rounded-lg border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent"
      onClick={() => void navigate({ to: '/brands/$brandId', params: { brandId: brand.id } })}
    >
      <div className="font-semibold group-hover:text-accent-foreground">{brand.name}</div>
      {brand.description && (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{brand.description}</div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">
        Created {new Date(brand.createdAt).toLocaleDateString()}
      </div>
    </button>
  )
}

function WorkspaceDetailPage() {
  const { wsId } = workspaceDetailRoute.useParams()
  const { data: workspace, isPending: wsPending, isError: wsError } = useWorkspace(wsId)
  const { data: brands, isPending: brandsPending, isError: brandsError } = useWorkspaceBrands(wsId)

  useEffect(() => {
    setLastWorkspaceId(wsId)
  }, [wsId])

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/workspaces" className="text-xs text-muted-foreground hover:text-foreground">
            ← Workspaces
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {wsPending ? '…' : wsError ? 'Workspace' : workspace?.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/workspaces/$wsId/settings"
            params={{ wsId }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
          <NewBrandDialog wsId={wsId} />
        </div>
      </div>

      {brandsPending && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {brandsError && <p className="mt-8 text-sm text-destructive">Failed to load brands.</p>}

      {brands?.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <p className="text-muted-foreground">No brands yet.</p>
          <p className="text-sm text-muted-foreground">
            Create a brand to start building guidelines and projects.
          </p>
        </div>
      )}

      {brands && brands.length > 0 && (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {brands.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}
    </div>
  )
}

export const workspaceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/$wsId',
  beforeLoad: () => {
    if (!getAuthToken()) throw redirect({ to: '/login' })
  },
  component: WorkspaceDetailPage,
})
