import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-border': 'var(--border)',
          '--normal-text': 'var(--popover-foreground)',
          '--success-bg': 'var(--popover)',
          '--success-border': 'var(--border)',
          '--success-text': 'var(--popover-foreground)',
          '--error-bg': 'var(--popover)',
          '--error-border': 'var(--border)',
          '--error-text': 'var(--popover-foreground)',
        } as CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
