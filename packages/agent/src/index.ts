// Agent orchestration — composes prompts, canvas context, and tool
// definitions and streams AgentEvents against an injected `LLMProvider`.
// Server-only (Phase 5). No DB, realtime, or HTTP deps — all side
// effects flow through the caller-supplied `CanvasOpApplier`.

export { streamResponse, type StreamResponseInput } from './stream'
export { buildSystemPrompt } from './prompts/system-prompt'
export {
  CANVAS_CONTEXT_UNPINNED_LIMIT,
  buildCanvasContext,
  type BuildCanvasContextInput,
} from './prompts/canvas-context'
export { buildCanvasTools, CANVAS_TOOL_NAMES } from './tools/definitions'
export type { CanvasOpApplier, AddCanvasBlockInput } from './tools/applier'
