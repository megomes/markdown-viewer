/**
 * The app's log: one line per thing worth knowing later, with how long it took.
 *
 * Each app decides where the lines go (`setLogSink`): the desktop writes them
 * to a rotating file through Tauri's log plugin, the phone keeps the last ones
 * in a file it can share and prints them to logcat. Everything else only calls
 * `log` and `timed`, and does not care where it ends up.
 *
 * Lines read as `[area] what key=value`, so a log can be searched by area and
 * the numbers can be compared between versions.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogSink = (level: LogLevel, line: string) => void

const consoleSink: LogSink = (level, line) => {
  // oxlint-disable-next-line no-console
  const write = level === 'debug' ? console.log : console[level]
  write(line)
}

let sink: LogSink = consoleSink

/** Where the lines go from now on. */
export function setLogSink(next: LogSink): void {
  sink = next
}

type Fields = Record<string, unknown>

function format(area: string, message: string, fields?: Fields): string {
  let line = `[${area}] ${message}`
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue
      const text =
        value instanceof Error
          ? value.message
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value)
      line += ` ${key}=${/\s/.test(text) ? JSON.stringify(text) : text}`
    }
  }
  return line
}

function emit(level: LogLevel, area: string, message: string, fields?: Fields): void {
  try {
    sink(level, format(area, message, fields))
  } catch {
    // A log that cannot be written never takes the app down with it.
  }
}

export const log = {
  debug: (area: string, message: string, fields?: Fields) => emit('debug', area, message, fields),
  info: (area: string, message: string, fields?: Fields) => emit('info', area, message, fields),
  warn: (area: string, message: string, fields?: Fields) => emit('warn', area, message, fields),
  error: (area: string, message: string, fields?: Fields) => emit('error', area, message, fields),
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** What is being timed right now, so a freeze in the log says during what. */
let running: string | null = null

/** The last `timed` piece of work still under way, if any. */
export function currentWork(): string | null {
  return running
}

/**
 * Runs `work` and logs how long it took. Below `slowMs` it is logged only at
 * debug level, so routine work stays out of the file and slow work stands out.
 * A failure is logged with its time too, and thrown again.
 */
export async function timed<T>(
  area: string,
  what: string,
  work: () => Promise<T>,
  options: { slowMs?: number; fields?: Fields } = {},
): Promise<T> {
  const started = clock()
  const before = running
  running = `${area}: ${what}`
  try {
    const result = await work()
    const ms = Math.round(clock() - started)
    const level = ms >= (options.slowMs ?? 0) ? 'info' : 'debug'
    emit(level, area, what, { ms, ...options.fields })
    return result
  } catch (error) {
    emit('error', area, what + ' falhou', {
      ms: Math.round(clock() - started),
      error,
      ...options.fields,
    })
    throw error
  } finally {
    running = before
  }
}
