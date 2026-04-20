import { useState } from 'react'
import { createRoute, Link, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { LLM_PROVIDER_IDS } from '@brandfactory/shared'
import type { LLMProviderId } from '@brandfactory/shared'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { AppError } from '@/api/client'
import { useWorkspaceSettings, useUpdateWorkspaceSettings } from '@/api/queries/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function SourceBadge({ source }: { source: 'workspace' | 'env' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        source === 'workspace' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {source === 'workspace' ? 'workspace setting' : 'env default'}
    </span>
  )
}

// Local edits overlay; null means "use whatever the server returned"
type FormDraft = { provider: LLMProviderId; model: string }

function WorkspaceSettingsPage() {
  const { wsId } = workspaceSettingsRoute.useParams()
  const { data: settings, isPending, isError } = useWorkspaceSettings(wsId)
  const mutation = useUpdateWorkspaceSettings(wsId)

  const [draft, setDraft] = useState<FormDraft | null>(null)

  const provider: LLMProviderId | '' = draft?.provider ?? settings?.llmProviderId ?? ''
  const model: string = draft?.model ?? settings?.llmModel ?? ''

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!provider || !model.trim()) return
    mutation.mutate(
      { llmProviderId: provider, llmModel: model.trim() },
      {
        onSuccess: () => {
          setDraft(null)
          toast.success('Settings saved')
        },
        onError: (err) =>
          toast.error(err instanceof AppError ? err.message : 'Failed to save settings'),
      },
    )
  }

  const isDirty =
    settings && (provider !== settings.llmProviderId || model.trim() !== settings.llmModel)

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6">
        <Link
          to="/workspaces/$wsId"
          params={{ wsId }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Workspace
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Workspace Settings</h1>
      </div>

      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="text-sm text-destructive">Failed to load settings.</p>}

      {settings && (
        <form onSubmit={handleSubmit} className="max-w-md space-y-6">
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="llm-provider">LLM provider</Label>
                <SourceBadge source={settings.source} />
              </div>
              <Select
                value={provider}
                onValueChange={(v) =>
                  setDraft((d) => ({ provider: v as LLMProviderId, model: d?.model ?? model }))
                }
              >
                <SelectTrigger id="llm-provider">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {LLM_PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="llm-model">Model</Label>
              <Input
                id="llm-model"
                placeholder="e.g. claude-sonnet-4-6"
                value={model}
                onChange={(e) =>
                  setDraft((d) => ({
                    provider: d?.provider ?? (provider as LLMProviderId),
                    model: e.target.value,
                  }))
                }
              />
            </div>

            <p className="text-xs text-muted-foreground">
              API keys for this provider are read from the server env. DB-persisted keys are a later
              pass.
            </p>
          </div>

          <Button
            type="submit"
            disabled={!provider || !model.trim() || !isDirty || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      )}
    </div>
  )
}

export const workspaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/$wsId/settings',
  beforeLoad: () => {
    if (!getAuthToken()) throw redirect({ to: '/login' })
  },
  component: WorkspaceSettingsPage,
})
