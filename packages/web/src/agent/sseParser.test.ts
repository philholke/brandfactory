import { describe, expect, it } from 'vitest'
import { SseFrameParser } from './sseParser'

describe('SseFrameParser', () => {
  it('parses a single framed event', () => {
    const p = new SseFrameParser()
    const frames = p.push('event: message\ndata: {"hi":1}\n\n')
    expect(frames).toEqual([{ event: 'message', data: '{"hi":1}' }])
  })

  it('defaults event to "message" when not specified', () => {
    const p = new SseFrameParser()
    const frames = p.push('data: hello\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'hello' }])
  })

  it('yields multiple frames from one chunk', () => {
    const p = new SseFrameParser()
    const frames = p.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: done\ndata: {}\n\n')
    expect(frames.map((f) => f.event)).toEqual(['a', 'b', 'done'])
    expect(frames.map((f) => f.data)).toEqual(['1', '2', '{}'])
  })

  it('buffers incomplete frames across pushes', () => {
    const p = new SseFrameParser()
    expect(p.push('event: mes')).toEqual([])
    expect(p.push('sage\ndata: {"x":')).toEqual([])
    const frames = p.push('1}\n\n')
    expect(frames).toEqual([{ event: 'message', data: '{"x":1}' }])
  })

  it('ignores keep-alive comments and blank lines', () => {
    const p = new SseFrameParser()
    // ": keep-alive" is a comment-only frame → yields nothing
    expect(p.push(': keep-alive\n\n')).toEqual([])
    // comment line interleaved with data in the same frame is skipped
    const frames = p.push(': ping\nevent: message\ndata: ok\n\n')
    expect(frames).toEqual([{ event: 'message', data: 'ok' }])
  })

  it('strips the optional leading space after the field colon', () => {
    const p = new SseFrameParser()
    // No space
    expect(p.push('event:a\ndata:b\n\n')).toEqual([{ event: 'a', data: 'b' }])
    // Single leading space (stripped)
    expect(p.push('event: a\ndata: b\n\n')).toEqual([{ event: 'a', data: 'b' }])
  })

  it('joins multiple data: lines with newlines', () => {
    const p = new SseFrameParser()
    const frames = p.push('event: msg\ndata: line1\ndata: line2\n\n')
    expect(frames).toEqual([{ event: 'msg', data: 'line1\nline2' }])
  })

  it('drops frames with no data field', () => {
    const p = new SseFrameParser()
    expect(p.push('event: heartbeat\n\n')).toEqual([])
  })
})
