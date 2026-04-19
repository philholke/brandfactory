import type { AgentEvent } from '@brandfactory/shared'
import type { Logger } from '../logger'

export const SSE_KEEPALIVE_MS = 15_000

export interface StreamResponseToSseOptions {
  events: AsyncIterable<AgentEvent>
  // Hook for persistence / fan-out: invoked for each event before it is
  // serialized to the wire. Phase 6 uses this to accumulate assistant text
  // and mirror message/tool-call events onto the realtime bus.
  onEvent?: (event: AgentEvent) => void
  // Fired in the ReadableStream's `finally` so it runs when the *stream*
  // ends, not when Hono's handler returns the Response. The route uses this
  // to release the concurrency guard and persist the assistant message —
  // see Phase 6 plan §6 "Two subtleties".
  onClose?: () => void | Promise<void>
  // Cancellation source — typically `c.req.raw.signal`. We watch it so we
  // stop enqueueing once the client disconnects; the underlying iterable's
  // own abortSignal handling stops upstream token generation.
  signal: AbortSignal
  log: Logger
  keepAliveMs?: number
}

// Convert a typed `AgentEvent` async iterable into a `text/event-stream`
// Response compatible with Vercel AI SDK UI's `useChat`. Each event is
// framed as `event: <kind>\ndata: <json>\n\n`. A trailing synthetic
// `event: done` lets clients stop listening deterministically; an
// `event: error` precedes `done` if the stream throws.
export function streamResponseToSse(opts: StreamResponseToSseOptions): Response {
  const encoder = new TextEncoder()
  const keepAliveMs = opts.keepAliveMs ?? SSE_KEEPALIVE_MS

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        } catch {
          // Controller closed mid-tick (client disconnected). The for-await
          // loop's `signal.aborted` check will exit cleanly on the next pass.
        }
      }, keepAliveMs)
      // Don't keep the event loop alive on test-mode fast keepalives.
      if (typeof (ping as { unref?: () => void }).unref === 'function') {
        ;(ping as { unref: () => void }).unref()
      }

      try {
        for await (const event of opts.events) {
          if (opts.signal.aborted) break
          opts.onEvent?.(event)
          controller.enqueue(
            encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`),
          )
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        opts.log.error('agent stream error', { err: message })
        try {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
          )
          controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
        } catch {
          // Controller already closed.
        }
      } finally {
        clearInterval(ping)
        try {
          await opts.onClose?.()
        } catch (closeErr) {
          opts.log.error('agent stream onClose failed', {
            err: closeErr instanceof Error ? closeErr.message : String(closeErr),
          })
        }
        controller.close()
      }
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      // Disable nginx buffering for the SSE path. Same as Next.js's RSC
      // streaming convention; harmless when no proxy is in front.
      'x-accel-buffering': 'no',
    },
  })
}
