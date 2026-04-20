import { createRoute, redirect } from '@tanstack/react-router'
import { rootRoute } from './__root'
import { getAuthToken } from '@/auth/store'
import { LocalAuthProvider } from '@/auth/providers/local'
import { SupabaseAuthProvider } from '@/auth/providers/supabase'

function LoginPage() {
  const provider = import.meta.env.VITE_AUTH_PROVIDER
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">BrandFactory</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>
        {provider === 'supabase' ? <SupabaseAuthProvider /> : <LocalAuthProvider />}
      </div>
    </div>
  )
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    if (getAuthToken()) throw redirect({ to: '/workspaces' })
  },
  component: LoginPage,
})
