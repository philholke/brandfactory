// Narrow facade over `@brandfactory/db` listing every helper the server
// actually calls. Routes and authz take this interface (or a subset) as
// their dep, so tests can drop in fakes without importing the real
// singleton. `buildDbDeps()` just hands over the imported bindings; the
// underlying `db`/`pool` singleton still opens at import time (Phase 4
// accepted that trade-off — see `docs/executing/phase-4-server.md`
// open-questions).

import * as db from '@brandfactory/db'

export interface Db {
  // Users
  getUserById: typeof db.getUserById

  // Workspaces
  getWorkspaceById: typeof db.getWorkspaceById
  listWorkspacesByOwner: typeof db.listWorkspacesByOwner
  createWorkspace: typeof db.createWorkspace

  // Brands + guideline sections
  getBrandById: typeof db.getBrandById
  listBrandsByWorkspace: typeof db.listBrandsByWorkspace
  createBrand: typeof db.createBrand
  listSectionsByBrand: typeof db.listSectionsByBrand
  updateBrandGuidelines: typeof db.updateBrandGuidelines

  // Projects + canvases
  getProjectById: typeof db.getProjectById
  listProjectsByBrand: typeof db.listProjectsByBrand
  createProjectWithCanvas: typeof db.createProjectWithCanvas
  getCanvasByProject: typeof db.getCanvasByProject

  // Workspace settings
  getWorkspaceSettings: typeof db.getWorkspaceSettings
  upsertWorkspaceSettings: typeof db.upsertWorkspaceSettings
}

export function buildDbDeps(): Db {
  return {
    getUserById: db.getUserById,
    getWorkspaceById: db.getWorkspaceById,
    listWorkspacesByOwner: db.listWorkspacesByOwner,
    createWorkspace: db.createWorkspace,
    getBrandById: db.getBrandById,
    listBrandsByWorkspace: db.listBrandsByWorkspace,
    createBrand: db.createBrand,
    listSectionsByBrand: db.listSectionsByBrand,
    updateBrandGuidelines: db.updateBrandGuidelines,
    getProjectById: db.getProjectById,
    listProjectsByBrand: db.listProjectsByBrand,
    createProjectWithCanvas: db.createProjectWithCanvas,
    getCanvasByProject: db.getCanvasByProject,
    getWorkspaceSettings: db.getWorkspaceSettings,
    upsertWorkspaceSettings: db.upsertWorkspaceSettings,
  }
}
