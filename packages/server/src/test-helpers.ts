import type { AuthProvider } from '@brandfactory/adapter-auth'
import type { BlobStore } from '@brandfactory/adapter-storage'
import type { LLMProvider } from '@brandfactory/adapter-llm'
import type { RealtimeBus } from '@brandfactory/adapter-realtime'
import type {
  Brand,
  BrandGuidelineSection,
  BrandId,
  Canvas,
  Project,
  ProjectId,
  Workspace,
  WorkspaceId,
  WorkspaceSettings,
} from '@brandfactory/shared'
import { createApp, type AppDeps } from './app'
import type { Db } from './db'
import type { Env } from './env'
import { createLogger, type Logger } from './logger'

// Fakes used by route / middleware / authz tests. Keep the shape matching
// the real Db exactly — switching a helper's signature in `@brandfactory/db`
// surfaces here as a type error.

export function silentLogger(): Logger {
  return createLogger({ level: 'error', write: () => {} })
}

interface FakeUserRow {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  updatedAt: string
}

export interface FakeDbState {
  users: Map<string, FakeUserRow>
  workspaces: Map<string, Workspace>
  brands: Map<string, Brand>
  sections: Map<string, BrandGuidelineSection>
  projects: Map<string, Project>
  canvases: Map<string, Canvas>
  settings: Map<string, WorkspaceSettings>
}

export function createFakeDbState(): FakeDbState {
  return {
    users: new Map(),
    workspaces: new Map(),
    brands: new Map(),
    sections: new Map(),
    projects: new Map(),
    canvases: new Map(),
    settings: new Map(),
  }
}

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString().padStart(6, '0')}`
}

const NOW = '2026-04-19T00:00:00.000Z'

export function createFakeDb(state: FakeDbState = createFakeDbState()): {
  db: Db
  state: FakeDbState
} {
  const db: Db = {
    async getUserById(id) {
      return state.users.get(id) ?? null
    },

    async getWorkspaceById(id) {
      return state.workspaces.get(id) ?? null
    },
    async listWorkspacesByOwner(ownerUserId) {
      return [...state.workspaces.values()].filter((w) => w.ownerUserId === ownerUserId)
    },
    async createWorkspace(input) {
      const id = nextId('ws') as WorkspaceId
      const row: Workspace = {
        id,
        name: input.name,
        ownerUserId: input.ownerUserId,
        createdAt: NOW,
        updatedAt: NOW,
      }
      state.workspaces.set(id, row)
      return row
    },

    async getBrandById(id) {
      return state.brands.get(id) ?? null
    },
    async listBrandsByWorkspace(workspaceId) {
      return [...state.brands.values()].filter((b) => b.workspaceId === workspaceId)
    },
    async createBrand(input) {
      const id = nextId('br') as BrandId
      const row: Brand = {
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        createdAt: NOW,
        updatedAt: NOW,
      }
      state.brands.set(id, row)
      return row
    },
    async listSectionsByBrand(brandId) {
      return [...state.sections.values()]
        .filter((s) => s.brandId === brandId)
        .sort((a, b) => a.priority - b.priority)
    },
    async updateBrandGuidelines(brandId, sections) {
      for (const section of sections) {
        if (section.id) {
          const existing = state.sections.get(section.id)
          if (!existing || existing.brandId !== brandId) {
            throw new Error(`section ${section.id} not in brand ${brandId}`)
          }
          state.sections.set(section.id, {
            ...existing,
            label: section.label,
            body: section.body,
            priority: section.priority,
            createdBy: section.createdBy,
            updatedAt: NOW,
          })
        } else {
          const id = nextId('sec') as BrandGuidelineSection['id']
          state.sections.set(id, {
            id,
            brandId,
            label: section.label,
            body: section.body,
            priority: section.priority,
            createdBy: section.createdBy,
            createdAt: NOW,
            updatedAt: NOW,
          })
        }
      }
      return [...state.sections.values()]
        .filter((s) => s.brandId === brandId)
        .sort((a, b) => a.priority - b.priority)
    },

    async getProjectById(id) {
      return state.projects.get(id) ?? null
    },
    async listProjectsByBrand(brandId) {
      return [...state.projects.values()].filter((p) => p.brandId === brandId)
    },
    async createProjectWithCanvas(input) {
      const id = nextId('pr') as ProjectId
      const base = {
        id,
        brandId: input.brandId,
        name: input.name,
        createdAt: NOW,
        updatedAt: NOW,
      }
      const project: Project =
        input.kind === 'standardized'
          ? { ...base, kind: 'standardized', templateId: input.templateId }
          : { ...base, kind: 'freeform' }
      state.projects.set(id, project)
      const canvasId = nextId('cv') as Canvas['id']
      const canvas: Canvas = { id: canvasId, projectId: id, createdAt: NOW, updatedAt: NOW }
      state.canvases.set(canvasId, canvas)
      return { project, canvas }
    },
    async getCanvasByProject(projectId) {
      return [...state.canvases.values()].find((canvas) => canvas.projectId === projectId) ?? null
    },

    async getWorkspaceSettings(workspaceId) {
      return state.settings.get(workspaceId) ?? null
    },
    async upsertWorkspaceSettings(input) {
      const row: WorkspaceSettings = {
        workspaceId: input.workspaceId,
        llmProviderId: input.llmProviderId,
        llmModel: input.llmModel,
        updatedAt: NOW,
      }
      state.settings.set(input.workspaceId, row)
      return row
    },
  }
  return { db, state }
}

export function createFakeAuth(tokenToUserId: Record<string, string>): AuthProvider {
  return {
    async verifyToken(token: string) {
      const userId = tokenToUserId[token]
      if (!userId) throw new Error('invalid token')
      return { userId }
    },
    async getUserById(id: string) {
      return {
        id,
        email: `${id}@example.com`,
        displayName: null,
        createdAt: NOW,
        updatedAt: NOW,
      }
    },
  }
}

export function createFakeAdapters(overrides: Partial<AppDeps> = {}): Omit<AppDeps, 'env' | 'log'> {
  const storage: BlobStore = overrides.storage ?? {
    async put() {},
    async get() {
      return new Uint8Array()
    },
    async delete() {},
    async getSignedReadUrl() {
      return 'http://signed'
    },
    async getSignedWriteUrl() {
      return { url: 'http://signed' }
    },
  }
  const realtime: RealtimeBus = overrides.realtime ?? {
    async publish() {},
    subscribe: () => () => {},
  }
  const llm: LLMProvider = overrides.llm ?? {
    // Return a placeholder object; tests that call it will fail loudly.
    getModel: () => {
      throw new Error('llm.getModel not expected in test')
    },
  }
  const { db } = overrides.db ? { db: overrides.db } : createFakeDb()
  const auth = overrides.auth ?? createFakeAuth({})
  return { db, auth, storage, realtime, llm }
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DATABASE_URL: 'postgres://x',
    AUTH_PROVIDER: 'local',
    STORAGE_PROVIDER: 'local-disk',
    REALTIME_PROVIDER: 'native-ws',
    LLM_PROVIDER: 'anthropic',
    LLM_MODEL: 'claude-sonnet-4-6',
    BLOB_LOCAL_DISK_ROOT: '/tmp/blobs',
    BLOB_SIGNING_SECRET: 'test-secret',
    BLOB_PUBLIC_BASE_URL: 'http://localhost:3001/blobs',
    BLOB_MAX_BYTES: 25 * 1024 * 1024,
    ANTHROPIC_API_KEY: 'ak',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'error',
    ...overrides,
  } as Env
}

export interface TestHarness {
  app: ReturnType<typeof createApp>
  state: FakeDbState
  auth: AuthProvider
  tokens: Record<string, string>
}

export function createTestApp(
  opts: {
    users?: Array<{ id: string; token: string }>
    env?: Partial<Env>
    storage?: BlobStore
  } = {},
): TestHarness {
  const { db, state } = createFakeDb()
  for (const u of opts.users ?? []) {
    state.users.set(u.id, {
      id: u.id,
      email: `${u.id}@example.com`,
      displayName: null,
      createdAt: NOW,
      updatedAt: NOW,
    })
  }
  const tokens: Record<string, string> = {}
  for (const u of opts.users ?? []) tokens[u.token] = u.id
  const auth = createFakeAuth(tokens)
  const env = testEnv(opts.env)
  const adapters = createFakeAdapters({
    db,
    auth,
    ...(opts.storage ? { storage: opts.storage } : {}),
  })
  const app = createApp({ ...adapters, env, log: silentLogger() })
  return { app, state, auth, tokens }
}
