// Minimal SSE frame parser. We only consume what the server sends:
// `event: <kind>\ndata: <json>\n\n`, `: keep-alive\n\n` comments, and the
// sentinel `event: done\ndata: {}\n\n`. `eventsource-parser` would work too
// but we control both ends and this is ~40 lines.

export interface SseFrame {
  event: string
  data: string
}

export class SseFrameParser {
  private buffer = ''

  // Feeds a chunk and yields every complete frame buffered so far. The
  // trailing partial frame (if any) stays in the buffer until the next feed.
  push(chunk: string): SseFrame[] {
    this.buffer += chunk
    const frames: SseFrame[] = []
    let sep: number
    while ((sep = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, sep)
      this.buffer = this.buffer.slice(sep + 2)
      const frame = parseFrame(raw)
      if (frame) frames.push(frame)
    }
    return frames
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith(':') || line.length === 0) continue // comment / blank
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon)
    const value = line[colon + 1] === ' ' ? line.slice(colon + 2) : line.slice(colon + 1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
