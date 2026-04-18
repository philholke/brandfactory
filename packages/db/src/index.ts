// Client — singleton pg Pool + drizzle instance.
export { db, pool } from './client'

// Schema — tables and pgEnums, grouped per aggregate under `./schema`.
export * from './schema'

// Query helpers, grouped by aggregate. "Dumb" CRUD; no business rules.
export * from './queries/users'
export * from './queries/workspaces'
export * from './queries/brands'
export * from './queries/projects'
export * from './queries/canvas'
export * from './queries/events'
