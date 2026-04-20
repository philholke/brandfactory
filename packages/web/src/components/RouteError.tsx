import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { AppError } from '@/api/client'

export function RouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter()
  const message =
    error instanceof AppError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong.'

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            reset?.()
            void router.invalidate()
          }}
        >
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.history.back()}>
          Go back
        </Button>
      </div>
    </div>
  )
}

export function RoutePending() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
    </div>
  )
}
