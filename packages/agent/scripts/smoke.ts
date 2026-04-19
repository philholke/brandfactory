// Smoke script — drives `streamResponse` against a real `LLMProvider`
// (openrouter by default) using an in-memory `CanvasOpApplier`. Not a
// unit test; gated on `OPENROUTER_API_KEY` so it doesn't blow up for
// contributors who haven't configured an LLM yet.
//
//   OPENROUTER_API_KEY=... pnpm --filter @brandfactory/agent smoke

import { randomUUID } from 'node:crypto'
import { createLLMProvider } from '@brandfactory/adapter-llm'
import type {
  AgentEvent,
  BrandId,
  BrandWithSections,
  CanvasBlock,
  CanvasBlockId,
  CanvasId,
  ProseMirrorDoc,
  SectionId,
  TextCanvasBlock,
  WorkspaceId,
} from '@brandfactory/shared'
import { streamResponse } from '../src/index'
import type { AddCanvasBlockInput, CanvasOpApplier } from '../src/index'

const apiKey: string | undefined = process.env['OPENROUTER_API_KEY']
if (!apiKey) {
  console.error('smoke: OPENROUTER_API_KEY is required. Set it to a valid key and re-run.')
  process.exit(1)
}
const resolvedKey: string = apiKey

const now = new Date().toISOString()

function pmParagraph(text: string): ProseMirrorDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function textBlock(id: string, text: string, isPinned: boolean): TextCanvasBlock {
  return {
    id: id as CanvasBlockId,
    canvasId: 'c_smoke' as CanvasId,
    kind: 'text',
    body: pmParagraph(text),
    position: 0,
    isPinned,
    pinnedAt: isPinned ? now : null,
    createdBy: 'user',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

const brand: BrandWithSections = {
  id: 'b_smoke' as BrandId,
  workspaceId: 'w_smoke' as WorkspaceId,
  name: 'Northstar Coffee',
  description: 'Specialty roaster with a minimalist aesthetic.',
  createdAt: now,
  updatedAt: now,
  sections: [
    {
      id: 's_voice' as SectionId,
      brandId: 'b_smoke' as BrandId,
      label: 'Voice',
      body: pmParagraph('Warm, direct, unpretentious. No hype words.'),
      priority: 10,
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 's_audience' as SectionId,
      brandId: 'b_smoke' as BrandId,
      label: 'Audience',
      body: pmParagraph('Urban 25–40 year-olds who notice design details.'),
      priority: 20,
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
    },
  ],
}

const blocks: CanvasBlock[] = [
  textBlock('blk_existing', 'Slow mornings, strong coffee.', true),
  textBlock('blk_draft', 'Roasted with care. Served with purpose.', false),
]

class InMemoryApplier implements CanvasOpApplier {
  readonly added: CanvasBlock[] = []
  readonly pinned: CanvasBlockId[] = []
  readonly unpinned: CanvasBlockId[] = []

  addCanvasBlock(input: AddCanvasBlockInput): Promise<CanvasBlock> {
    const block: TextCanvasBlock = {
      id: `blk_${randomUUID().slice(0, 8)}` as CanvasBlockId,
      canvasId: 'c_smoke' as CanvasId,
      kind: 'text',
      body: input.body,
      position: input.position,
      isPinned: false,
      pinnedAt: null,
      createdBy: 'agent',
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.added.push(block)
    return Promise.resolve(block)
  }

  pinBlock(blockId: CanvasBlockId): Promise<CanvasBlock> {
    this.pinned.push(blockId)
    return Promise.resolve(textBlock(String(blockId), '(pinned)', true))
  }

  unpinBlock(blockId: CanvasBlockId): Promise<CanvasBlock> {
    this.unpinned.push(blockId)
    return Promise.resolve(textBlock(String(blockId), '(unpinned)', false))
  }
}

async function main(): Promise<void> {
  const provider = createLLMProvider({ openrouter: { apiKey: resolvedKey } })
  const applier = new InMemoryApplier()

  const events = streamResponse({
    brand,
    blocks,
    shortlistBlockIds: blocks.filter((b) => b.isPinned).map((b) => b.id),
    messages: [
      {
        kind: 'message',
        id: 'u_1',
        role: 'user',
        content:
          'Suggest three tagline ideas for Northstar Coffee and use add_canvas_block to post each one. Then pin whichever you think is the strongest.',
      },
    ],
    llmProvider: provider,
    llmSettings: { providerId: 'openrouter', modelId: 'anthropic/claude-3.5-sonnet' },
    applier,
  })

  for await (const event of events) printEvent(event)

  console.log('---')
  console.log(
    `applier: added ${applier.added.length}, pinned ${applier.pinned.length}, unpinned ${applier.unpinned.length}`,
  )
  if (applier.added.length === 0) {
    console.warn('smoke: applier never received add_canvas_block — check model tool-use support.')
    process.exit(2)
  }
}

function printEvent(event: AgentEvent): void {
  switch (event.kind) {
    case 'message':
      console.log(`[message ${event.id.slice(0, 8)}] ${event.content}`)
      break
    case 'tool-call':
      console.log(`[tool-call ${event.toolName}] args=${JSON.stringify(event.args)}`)
      break
    case 'canvas-op':
      console.log(`[canvas-op ${event.op.op}]`, event.op)
      break
    case 'pin-op':
      console.log(`[pin-op ${event.op.op} ${event.op.blockId}]`)
      break
  }
}

main().catch((err: unknown) => {
  console.error('smoke: fatal', err)
  process.exit(1)
})
