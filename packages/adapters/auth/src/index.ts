// Auth adapter — identity provider port + impls.
//
// Shipped impls:
//   - local    (dev-only, token = user_id)
//   - supabase (JWT verified against project JWKS)
//
// Future impls: oidc (generic), clerk, auth0.

export * from './port'
export * from './local'
export * from './supabase'
