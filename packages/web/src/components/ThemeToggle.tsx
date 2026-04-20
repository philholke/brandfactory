import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { applyTheme, getStoredTheme, setStoredTheme, type ThemeMode } from '@/lib/theme'

// Cycles light → dark → system. `system` re-reads `prefers-color-scheme`
// whenever the OS flips it; the other modes pin the class on <html>.
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme)

  useEffect(() => {
    applyTheme(mode)
    setStoredTheme(mode)
  }, [mode])

  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor
  const label = `Theme: ${mode} (click for ${next})`

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label={label}
      title={label}
      onClick={() => setMode(next)}
    >
      <Icon className="size-4" />
    </Button>
  )
}
