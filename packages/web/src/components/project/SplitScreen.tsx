import { useCallback, useRef, useState, type ReactNode } from 'react'

const MIN_LEFT_PCT = 25
const MAX_LEFT_PCT = 65
const DEFAULT_LEFT_PCT = 36

// Two-pane split with a draggable vertical divider. Hand-rolled (pointer
// capture + a ref flag) rather than pulling in vaul — the behaviour is ~30
// lines and we don't need drawer semantics.
export function SplitScreen({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setLeftPct(Math.min(MAX_LEFT_PCT, Math.max(MIN_LEFT_PCT, pct)))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-col border-r" style={{ flexBasis: `${leftPct}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="flex min-w-0 flex-1 flex-col">{right}</div>
    </div>
  )
}
