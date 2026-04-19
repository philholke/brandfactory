// 40-line inline JSON logger. Phase 4 is a skeleton; pino lands in Phase 8
// when we containerize and need shipping/rotation.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

type Fields = Record<string, unknown>

export interface Logger {
  debug: (msg: string, fields?: Fields) => void
  info: (msg: string, fields?: Fields) => void
  warn: (msg: string, fields?: Fields) => void
  error: (msg: string, fields?: Fields) => void
  child: (fields: Fields) => Logger
}

export interface CreateLoggerOptions {
  level: LogLevel
  now?: () => Date
  write?: (line: string) => void
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const threshold = LEVEL_ORDER[opts.level]
  const now = opts.now ?? (() => new Date())
  const write = opts.write ?? ((line: string) => process.stdout.write(line + '\n'))

  function make(bound: Fields): Logger {
    function emit(level: LogLevel, msg: string, fields?: Fields): void {
      if (LEVEL_ORDER[level] < threshold) return
      const line = JSON.stringify({
        ts: now().toISOString(),
        level,
        msg,
        ...bound,
        ...fields,
      })
      write(line)
    }
    return {
      debug: (msg, fields) => emit('debug', msg, fields),
      info: (msg, fields) => emit('info', msg, fields),
      warn: (msg, fields) => emit('warn', msg, fields),
      error: (msg, fields) => emit('error', msg, fields),
      child: (fields) => make({ ...bound, ...fields }),
    }
  }

  return make({})
}
