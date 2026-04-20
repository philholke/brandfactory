// CORS + WS-origin gating for split-origin deployments.
//
// `CORS_ALLOWED_ORIGINS` is optional and comma-separated:
//   - unset (or empty) → no allowlist. CORS middleware isn't mounted and
//     the WS upgrade accepts any origin. Matches the single-origin dev
//     default (web + server behind Vite's proxy).
//   - set              → exact-match allowlist. HTTP gets `hono/cors`
//     with `origin: req → allowlist.includes(origin) ? origin : null`,
//     and the WS upgrade rejects `Origin` headers that aren't in the
//     list before handing the socket to the adapter.

export function parseCorsAllowedOrigins(raw: string | undefined): string[] | null {
  if (!raw) return null
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return list.length > 0 ? list : null
}

// Policy: `null` allowlist means "no restriction" (dev). When the
// allowlist is set, a missing or non-matching `Origin` is denied. Same
// rule applies to HTTP preflight and WS upgrade so the two can't drift.
export function isOriginAllowed(origin: string | undefined, allowlist: string[] | null): boolean {
  if (allowlist === null) return true
  if (!origin) return false
  return allowlist.includes(origin)
}
