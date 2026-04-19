import { describe, expect, it } from 'vitest'
import type { ProseMirrorDoc } from '@brandfactory/shared'
import {
  rowToAgentMessage,
  rowToBrand,
  rowToCanvas,
  rowToCanvasBlock,
  rowToGuidelineSection,
  rowToProject,
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
