import { describe, expect, it } from 'vitest'
import type { ProseMirrorDoc } from '@brandfactory/shared'
import {
  rowToAgentMessage,
  rowToBrand,
  rowToBrandSummary,
  rowToCanvas,
  rowToCanvasBlock,
  rowToGuidelineSection,
  rowToProject,
  rowToProjectSummary,
  rowToWorkspace,
} from './mappers'

const TS = '2026-01-01T00:00:00.000Z'
const TEXT_DOC: ProseMirrorDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
}

describe('mappers — happy paths', () => {
  it('rowToWorkspace passes through fields with branded ids', () => {
    const row = {
      id: 'ws-1',
      name: 'Acme',
      ownerUserId: 'u-1',
      createdAt: TS,
      updatedAt: TS,
    }
    const ws = rowToWorkspace(row)
    expect(ws.id).toBe('ws-1')
    expect(ws.ownerUserId).toBe('u-1')
  })

  it('rowToBrand preserves nullable description', () => {
    const row = {
      id: 'b-1',
      workspaceId: 'ws-1',
      name: 'Brand',
      description: null,
      createdAt: TS,
      updatedAt: TS,
    }
    const b = rowToBrand(row)
    expect(b.description).toBeNull()
  })

  it('rowToBrandSummary attaches section and project counts', () => {
    const row = {
      id: 'b-1',
      workspaceId: 'ws-1',
      name: 'Brand',
      description: null,
      createdAt: TS,
      updatedAt: TS,
      sectionCount: 3,
      projectCount: 1,
    }
    expect(rowToBrandSummary(row)).toMatchObject({
      id: 'b-1',
      sectionCount: 3,
      projectCount: 1,
    })
  })

  it('rowToProjectSummary normalizes Date lastActivityAt to ISO string', () => {
    const when = new Date('2026-04-20T12:00:00.000Z')
    const summary = rowToProjectSummary({
      id: 'p-1',
      brandId: 'b-1',
      kind: 'freeform',
      templateId: null,
      name: 'Proj',
      createdAt: TS,
      updatedAt: TS,
      brandName: 'Acme',
      lastActivityAt: when,
    })
    expect(summary.brandName).toBe('Acme')
    expect(summary.lastActivityAt).toBe('2026-04-20T12:00:00.000Z')
    expect(summary.kind).toBe('freeform')
  })

  it('rowToCanvas passes through', () => {
    const row = { id: 'c-1', projectId: 'p-1', createdAt: TS, updatedAt: TS }
    expect(rowToCanvas(row).projectId).toBe('p-1')
  })

  it('rowToGuidelineSection parses a valid ProseMirror body', () => {
    const row = {
      id: 'gs-1',
      brandId: 'b-1',
      label: 'Voice',
      body: TEXT_DOC,
      priority: 1,
      createdBy: 'user' as const,
      createdAt: TS,
      updatedAt: TS,
    }
    expect(rowToGuidelineSection(row).body).toEqual(TEXT_DOC)
  })

  it('rowToProject discriminates freeform vs standardized', () => {
    const base = {
      id: 'p-1',
      brandId: 'b-1',
      name: 'Proj',
      createdAt: TS,
      updatedAt: TS,
    }
    expect(rowToProject({ ...base, kind: 'freeform', templateId: null })).toMatchObject({
      kind: 'freeform',
    })
    expect(
      rowToProject({ ...base, kind: 'standardized', templateId: 'content-calendar' }),
    ).toMatchObject({ kind: 'standardized', templateId: 'content-calendar' })
  })

  it('rowToCanvasBlock text variant parses body', () => {
    const row = {
      id: 'bk-1',
      canvasId: 'c-1',
      kind: 'text' as const,
      position: 1,
      isPinned: false,
      pinnedAt: null,
      createdBy: 'user' as const,
      deletedAt: null,
      createdAt: TS,
      updatedAt: TS,
      body: TEXT_DOC,
      blobKey: null,
      alt: null,
      width: null,
      height: null,
      filename: null,
      mime: null,
    }
    const block = rowToCanvasBlock(row)
    expect(block.kind).toBe('text')
    if (block.kind === 'text') expect(block.body).toEqual(TEXT_DOC)
  })

  it('rowToAgentMessage drops DB-only fields and emits the AgentMessage wire shape', () => {
    const row = {
      id: 'am-1',
      projectId: 'p-1',
      role: 'assistant' as const,
      content: 'Hello from the model.',
      userId: null,
      createdAt: TS,
    }
    const msg = rowToAgentMessage(row)
    expect(msg.kind).toBe('message')
    expect(msg.id).toBe('am-1')
    expect(msg.role).toBe('assistant')
    expect(msg.content).toBe('Hello from the model.')
  })

  it('rowToCanvasBlock image variant includes optional dims', () => {
    const row = {
      id: 'bk-2',
      canvasId: 'c-1',
      kind: 'image' as const,
      position: 2,
      isPinned: true,
      pinnedAt: TS,
      createdBy: 'agent' as const,
      deletedAt: null,
      createdAt: TS,
      updatedAt: TS,
      body: null,
      blobKey: 'blobs/img.png',
      alt: 'A logo',
      width: 200,
      height: 100,
      filename: null,
      mime: null,
    }
    const block = rowToCanvasBlock(row)
    expect(block.kind).toBe('image')
    if (block.kind === 'image') {
      expect(block.blobKey).toBe('blobs/img.png')
      expect(block.alt).toBe('A logo')
      expect(block.width).toBe(200)
    }
  })
})

describe('mappers — data-integrity failures fail loud', () => {
  it('rowToGuidelineSection throws on a malformed ProseMirror body', () => {
    const row = {
      id: 'gs-bad',
      brandId: 'b-1',
      label: 'Voice',
      // A circular-looking value simulated: Map isn't JSON, so the schema rejects.
      body: new Map() as unknown,
      priority: 1,
      createdBy: 'user' as const,
      createdAt: TS,
      updatedAt: TS,
    }
    expect(() => rowToGuidelineSection(row)).toThrow(/malformed ProseMirror body/)
  })

  it('rowToCanvasBlock text variant throws on a malformed body', () => {
    const row = {
      id: 'bk-bad',
      canvasId: 'c-1',
      kind: 'text' as const,
      position: 1,
      isPinned: false,
      pinnedAt: null,
      createdBy: 'user' as const,
      deletedAt: null,
      createdAt: TS,
      updatedAt: TS,
      body: new Map() as unknown,
      blobKey: null,
      alt: null,
      width: null,
      height: null,
      filename: null,
      mime: null,
    }
    expect(() => rowToCanvasBlock(row)).toThrow(/malformed ProseMirror body/)
  })

  it('rowToProject throws on a standardized row with null templateId', () => {
    expect(() =>
      rowToProject({
        id: 'p-bad',
        brandId: 'b-1',
        kind: 'standardized',
        name: 'Proj',
        templateId: null,
        createdAt: TS,
        updatedAt: TS,
      }),
    ).toThrow(/missing templateId/)
  })

  it('rowToCanvasBlock image variant throws on missing blobKey', () => {
    const row = {
      id: 'bk-bad-img',
      canvasId: 'c-1',
      kind: 'image' as const,
      position: 1,
      isPinned: false,
      pinnedAt: null,
      createdBy: 'user' as const,
      deletedAt: null,
      createdAt: TS,
      updatedAt: TS,
      body: null,
      blobKey: null,
      alt: null,
      width: null,
      height: null,
      filename: null,
      mime: null,
    }
    expect(() => rowToCanvasBlock(row)).toThrow(/missing blobKey/)
  })

  it('rowToCanvasBlock file variant throws on missing filename', () => {
    const row = {
      id: 'bk-bad-file',
      canvasId: 'c-1',
      kind: 'file' as const,
      position: 1,
      isPinned: false,
      pinnedAt: null,
      createdBy: 'user' as const,
      deletedAt: null,
      createdAt: TS,
      updatedAt: TS,
      body: null,
      blobKey: 'blobs/doc.pdf',
      alt: null,
      width: null,
      height: null,
      filename: null,
      mime: 'application/pdf',
    }
    expect(() => rowToCanvasBlock(row)).toThrow(/missing filename/)
  })
})

// Regression guard for the timestamp-format bug: Postgres hands back its own
// text format, not ISO 8601, and drizzle's `mode: 'string'` passes it through
// untouched. Every wire schema declares `z.iso.datetime()`, so mappers must
// normalise. Kept as a pure unit test — the live-DB suite that first caught
// this only runs when DATABASE_URL is set.
describe('mappers — timestamp normalisation', () => {
  const PG = '2026-07-22 07:57:59.635905+00'
  const ISO = '2026-07-22T07:57:59.635Z'

  it('converts Postgres text-format timestamps to ISO 8601', () => {
    const ws = rowToWorkspace({
      id: 'ws-1',
      name: 'Acme',
      ownerUserId: 'u-1',
      createdAt: PG,
      updatedAt: PG,
    })
    expect(ws.createdAt).toBe(ISO)
    expect(ws.updatedAt).toBe(ISO)
  })

  it('leaves already-ISO values unchanged', () => {
    const b = rowToBrand({
      id: 'b-1',
      workspaceId: 'ws-1',
      name: 'Acme',
      description: null,
      createdAt: ISO,
      updatedAt: ISO,
    })
    expect(b.createdAt).toBe(ISO)
  })

  it('normalises nullable pinnedAt / deletedAt without turning null into a date', () => {
    const base = {
      id: 'cb-1',
      canvasId: 'c-1',
      kind: 'text' as const,
      body: TEXT_DOC,
      blobKey: null,
      alt: null,
      width: null,
      height: null,
      filename: null,
      mime: null,
      position: 1000,
      isPinned: true,
      createdBy: 'user' as const,
      createdAt: PG,
      updatedAt: PG,
    }
    const pinned = rowToCanvasBlock({ ...base, pinnedAt: PG, deletedAt: null })
    expect(pinned.pinnedAt).toBe(ISO)
    expect(pinned.deletedAt).toBeNull()

    const deleted = rowToCanvasBlock({ ...base, pinnedAt: null, deletedAt: PG })
    expect(deleted.pinnedAt).toBeNull()
    expect(deleted.deletedAt).toBe(ISO)
  })
})
