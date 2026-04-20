import { describe, expect, it, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type {
  AgentMessage,
  CanvasBlock,
  CanvasBlockId,
  ProjectDetail,
  TextCanvasBlock,
} from '@brandfactory/shared'
import { projectKeys } from '@/api/queries/projects'
import { applyAgentEvent } from './applyAgentEvent'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BRAND_ID = '22222222-2222-4222-8222-222222222222'
const CANVAS_ID = '33333333-3333-4333-8333-333333333333'
const BLOCK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as CanvasBlockId
const BLOCK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as CanvasBlockId

function textBlock(id: string, overrides: Partial<TextCanvasBlock> = {}): TextCanvasBlock {
  return {
    kind: 'text',
    id: id as TextCanvasBlock['id'],
    canvasId: CANVAS_ID as TextCanvasBlock['canvasId'],
    position: 1000,
    isPinned: false,
    pinnedAt: null,
    createdBy: 'user',
    deletedAt: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    body: { type: 'doc', content: [] },
    ...overrides,
  }
}

function makeDetail(blocks: CanvasBlock[], shortlistBlockIds: string[] = []): ProjectDetail {
  return {
    kind: 'freeform',
    id: PROJECT_ID as ProjectDetail['id'],
    brandId: BRAND_ID as ProjectDetail['brandId'],
    name: 'Test project',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    canvas: {
      id: CANVAS_ID as ProjectDetail['canvas']['id'],
      projectId: PROJECT_ID as ProjectDetail['canvas']['projectId'],
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    },
    blocks,
    shortlistBlockIds: shortlistBlockIds as ProjectDetail['shortlistBlockIds'],
    recentMessages: [],
    brand: {
      id: BRAND_ID as ProjectDetail['brand']['id'],
      workspaceId: '44444444-4444-4444-8444-444444444444' as ProjectDetail['brand']['workspaceId'],
      name: 'Test brand',
      description: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
      sections: [],
    },
  }
}

describe('applyAgentEvent', () => {
  let qc: QueryClient

  beforeEach(() => {
    qc = new QueryClient()
  })

  describe('canvas-op add-block', () => {
    it('appends to detail.blocks and the blocks cache', () => {
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([textBlock(BLOCK_A)]))
      qc.setQueryData(projectKeys.blocks(PROJECT_ID), [textBlock(BLOCK_A)] as CanvasBlock[])

      const newBlock = textBlock(BLOCK_B, { position: 2000 })
      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'canvas-op',
        op: { op: 'add-block', block: newBlock },
      })

      const detail = qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!
      const blocks = qc.getQueryData<CanvasBlock[]>(projectKeys.blocks(PROJECT_ID))!
      expect(detail.blocks.map((b) => b.id)).toEqual([BLOCK_A, BLOCK_B])
      expect(blocks.map((b) => b.id)).toEqual([BLOCK_A, BLOCK_B])
    })

    it('dedupes by block.id', () => {
      const existing = textBlock(BLOCK_A)
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([existing]))
      qc.setQueryData(projectKeys.blocks(PROJECT_ID), [existing] as CanvasBlock[])

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'canvas-op',
        op: { op: 'add-block', block: existing },
      })

      expect(qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!.blocks).toHaveLength(1)
      expect(qc.getQueryData<CanvasBlock[]>(projectKeys.blocks(PROJECT_ID))!).toHaveLength(1)
    })
  })

  describe('canvas-op update-block', () => {
    it('spreads the patch onto the matching block in both caches', () => {
      const existing = textBlock(BLOCK_A, { position: 1000 })
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([existing]))
      qc.setQueryData(projectKeys.blocks(PROJECT_ID), [existing] as CanvasBlock[])

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'canvas-op',
        op: { op: 'update-block', blockId: BLOCK_A, patch: { position: 5000 } },
      })

      expect(
        qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!.blocks[0]!.position,
      ).toBe(5000)
      expect(qc.getQueryData<CanvasBlock[]>(projectKeys.blocks(PROJECT_ID))![0]!.position).toBe(
        5000,
      )
    })
  })

  describe('canvas-op remove-block', () => {
    it('filters the block out of both caches', () => {
      const a = textBlock(BLOCK_A)
      const b = textBlock(BLOCK_B)
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([a, b]))
      qc.setQueryData(projectKeys.blocks(PROJECT_ID), [a, b] as CanvasBlock[])

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'canvas-op',
        op: { op: 'remove-block', blockId: BLOCK_A },
      })

      const detail = qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!
      expect(detail.blocks.map((x) => x.id)).toEqual([BLOCK_B])
      expect(
        qc.getQueryData<CanvasBlock[]>(projectKeys.blocks(PROJECT_ID))!.map((x) => x.id),
      ).toEqual([BLOCK_B])
    })
  })

  describe('pin-op', () => {
    it('pin flips isPinned and appends to shortlistBlockIds', () => {
      const existing = textBlock(BLOCK_A)
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([existing]))
      qc.setQueryData(projectKeys.blocks(PROJECT_ID), [existing] as CanvasBlock[])

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'pin-op',
        op: { op: 'pin', blockId: BLOCK_A },
      })

      const detail = qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!
      expect(detail.blocks[0]!.isPinned).toBe(true)
      expect(detail.shortlistBlockIds).toEqual([BLOCK_A])
      expect(qc.getQueryData<CanvasBlock[]>(projectKeys.blocks(PROJECT_ID))![0]!.isPinned).toBe(
        true,
      )
    })

    it('pin is idempotent — does not duplicate shortlist entries', () => {
      const existing = textBlock(BLOCK_A, { isPinned: true })
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([existing], [BLOCK_A]))

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'pin-op',
        op: { op: 'pin', blockId: BLOCK_A },
      })

      expect(
        qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!.shortlistBlockIds,
      ).toEqual([BLOCK_A])
    })

    it('unpin flips isPinned off and removes from shortlistBlockIds', () => {
      const existing = textBlock(BLOCK_A, { isPinned: true })
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([existing], [BLOCK_A]))
      qc.setQueryData(projectKeys.blocks(PROJECT_ID), [existing] as CanvasBlock[])

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'pin-op',
        op: { op: 'unpin', blockId: BLOCK_A },
      })

      const detail = qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!
      expect(detail.blocks[0]!.isPinned).toBe(false)
      expect(detail.shortlistBlockIds).toEqual([])
    })
  })

  describe('message', () => {
    it('appends an assistant message to recentMessages', () => {
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([]))

      const assistant: AgentMessage = {
        kind: 'message',
        id: 'msg-1',
        role: 'assistant',
        content: 'hello',
      }
      applyAgentEvent(qc, PROJECT_ID, assistant)

      expect(
        qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!.recentMessages,
      ).toEqual([assistant])
    })

    it('dedupes messages by id', () => {
      const existing: AgentMessage = {
        kind: 'message',
        id: 'msg-1',
        role: 'user',
        content: 'hi',
      }
      const detail = makeDetail([])
      detail.recentMessages = [existing]
      qc.setQueryData(projectKeys.detail(PROJECT_ID), detail)

      applyAgentEvent(qc, PROJECT_ID, existing)

      expect(
        qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!.recentMessages,
      ).toHaveLength(1)
    })
  })

  describe('tool-call', () => {
    it('is a no-op — cache is unchanged', () => {
      const existing = textBlock(BLOCK_A)
      qc.setQueryData(projectKeys.detail(PROJECT_ID), makeDetail([existing]))
      const before = qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))

      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'tool-call',
        callId: 'call-1',
        toolName: 'add_canvas_block',
        args: {},
      })

      expect(qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))).toBe(before)
    })
  })

  describe('missing cache entries', () => {
    it('does nothing when the detail cache is empty', () => {
      applyAgentEvent(qc, PROJECT_ID, {
        kind: 'canvas-op',
        op: { op: 'add-block', block: textBlock(BLOCK_A) },
      })
      expect(qc.getQueryData(projectKeys.detail(PROJECT_ID))).toBeUndefined()
      expect(qc.getQueryData(projectKeys.blocks(PROJECT_ID))).toBeUndefined()
    })
  })
})
