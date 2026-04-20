import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import type { ProjectDetail, TextCanvasBlock } from '@brandfactory/shared'
import { projectKeys } from '@/api/queries/projects'
import { useAuthStore } from '@/auth/store'
import { useAgentChat } from './useAgentChat'

const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    message: vi.fn(),
  },
}))

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BRAND_ID = '22222222-2222-4222-8222-222222222222'
const CANVAS_ID = '33333333-3333-4333-8333-333333333333'

function seedDetail(qc: QueryClient): void {
  const detail: ProjectDetail = {
    kind: 'freeform',
    id: PROJECT_ID as ProjectDetail['id'],
    brandId: BRAND_ID as ProjectDetail['brandId'],
    name: 'p',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    canvas: {
      id: CANVAS_ID as ProjectDetail['canvas']['id'],
      projectId: PROJECT_ID as ProjectDetail['canvas']['projectId'],
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    },
    blocks: [],
    shortlistBlockIds: [],
    recentMessages: [],
    brand: {
      id: BRAND_ID as ProjectDetail['brand']['id'],
      workspaceId: '44444444-4444-4444-8444-444444444444' as ProjectDetail['brand']['workspaceId'],
      name: 'b',
      description: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
      sections: [],
    },
  }
  qc.setQueryData(projectKeys.detail(PROJECT_ID), detail)
}

function streamResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function wrapper(qc: QueryClient) {
  function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return TestWrapper
}

const TEXT_BLOCK: TextCanvasBlock = {
  kind: 'text',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as TextCanvasBlock['id'],
  canvasId: CANVAS_ID as TextCanvasBlock['canvasId'],
  position: 1000,
  isPinned: false,
  pinnedAt: null,
  createdBy: 'agent',
  deletedAt: null,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
  body: { type: 'doc', content: [] },
}

describe('useAgentChat', () => {
  let qc: QueryClient
  const fetchMock = vi.fn()

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    seedDetail(qc)
    useAuthStore.setState({ token: 'tok', userId: 'u1' })
    vi.stubGlobal('fetch', fetchMock)
    toastError.mockClear()
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAuthStore.setState({ token: null, userId: null })
  })

  it('optimistically appends the user message and folds streamed events into the cache', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        // assistant message
        `event: message\ndata: ${JSON.stringify({
          kind: 'message',
          id: 'msg-assistant',
          role: 'assistant',
          content: 'three options…',
        })}\n\n`,
        // canvas add-block
        `event: canvas-op\ndata: ${JSON.stringify({
          kind: 'canvas-op',
          op: { op: 'add-block', block: TEXT_BLOCK },
        })}\n\n`,
        `event: done\ndata: {}\n\n`,
      ]),
    )

    const { result } = renderHook(() => useAgentChat(PROJECT_ID), { wrapper: wrapper(qc) })

    await act(async () => {
      await result.current.send('Give me three taglines')
    })

    await waitFor(() => expect(result.current.status).toBe('idle'))

    const detail = qc.getQueryData<ProjectDetail>(projectKeys.detail(PROJECT_ID))!
    expect(detail.recentMessages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: 'Give me three taglines' },
      { role: 'assistant', content: 'three options…' },
    ])
    expect(detail.blocks.map((b) => b.id)).toEqual([TEXT_BLOCK.id])
  })

  it('toasts AGENT_BUSY on 409 and sets error status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'AGENT_BUSY', message: 'busy' }), {
        status: 409,
        statusText: 'Conflict',
      }),
    )

    const { result } = renderHook(() => useAgentChat(PROJECT_ID), { wrapper: wrapper(qc) })

    await act(async () => {
      await result.current.send('hi')
    })

    expect(toastError).toHaveBeenCalledWith('Another turn is running on this project.')
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('409')
  })

  it('logs out on 401', async () => {
    const logout = vi.fn()
    useAuthStore.setState({ token: 'tok', userId: 'u1', logout })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
    )

    const { result } = renderHook(() => useAgentChat(PROJECT_ID), { wrapper: wrapper(qc) })
    await act(async () => {
      await result.current.send('hi')
    })

    expect(logout).toHaveBeenCalled()
    expect(result.current.status).toBe('error')
  })

  it('stops on an error event in the SSE stream', async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        `event: error\ndata: ${JSON.stringify({ message: 'upstream exploded' })}\n\n`,
      ]),
    )

    const { result } = renderHook(() => useAgentChat(PROJECT_ID), { wrapper: wrapper(qc) })
    await act(async () => {
      await result.current.send('hi')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('upstream exploded')
    expect(toastError).toHaveBeenCalledWith('upstream exploded')
  })

  it('ignores empty/whitespace input and does not hit the network', async () => {
    const { result } = renderHook(() => useAgentChat(PROJECT_ID), { wrapper: wrapper(qc) })
    await act(async () => {
      await result.current.send('   ')
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
