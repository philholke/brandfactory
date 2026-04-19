import type { CanvasBlock, CanvasBlockId, ProseMirrorDoc } from '@brandfactory/shared'

// Side-effect seam for agent tool calls. The agent package itself has no
// DB, storage, or realtime deps — the server (Phase 6) implements this
// interface against its real persistence layer and passes it in via
// `streamResponse`.
//
// Every method returns the applied `CanvasBlock` so the agent can echo
// a compact confirmation back to the model and synthesize a canvas-op
// event for downstream consumers (the realtime bus, the HTTP SSE
// stream) without making a second round-trip to the DB.
//
// v1 only supports adding a text block and pin/unpin. Richer tools
// (move, update, soft-delete, reorder, image/file creation) are
// deliberately deferred — see Phase 5 plan §5.4.
export interface CanvasOpApplier {
  addCanvasBlock(input: AddCanvasBlockInput): Promise<CanvasBlock>
  pinBlock(blockId: CanvasBlockId): Promise<CanvasBlock>
  unpinBlock(blockId: CanvasBlockId): Promise<CanvasBlock>
}

export interface AddCanvasBlockInput {
  kind: 'text'
  body: ProseMirrorDoc
  position: number
}

// image/file tool variants deferred to Phase 6+: both require a blobKey
// resolved by the separate upload flow, not minted by the agent.
