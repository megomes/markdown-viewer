/**
 * Where the phone's log lines go (`@markdown-viewer/core/log`): logcat, as any
 * React Native log does, and the last few hundred lines in a file on the
 * device, which Ajustes > "Compartilhar diagnóstico" sends anywhere.
 *
 * Errors nobody caught are logged too, before React Native shows or swallows
 * them: they are what "the app closed by itself" leaves behind.
 */

import { File, Paths } from 'expo-file-system'
import { log, setLogSink, type LogLevel } from '@markdown-viewer/core/log'

/** How many lines are kept. A few hundred cover the last sessions of use. */
const KEEP = 600
/** Lines are written to the file in bursts, not one write per line. */
const FLUSH_MS = 3000

const file = new File(Paths.document, 'diagnostics.log')
let lines: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function stamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function flush(): void {
  timer = null
  try {
    if (!file.exists) file.create()
    file.write(lines.join('\n') + '\n')
  } catch {
    // Without a file the lines still went to logcat.
  }
}

export function startDiagnostics(version: string): void {
  try {
    if (file.exists) lines = file.textSync().split('\n').filter(Boolean).slice(-KEEP)
  } catch {
    lines = []
  }

  setLogSink((level: LogLevel, line: string) => {
    // oxlint-disable-next-line no-console
    ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line)
    if (level === 'debug') return
    lines.push(`${stamp()} ${level.toUpperCase()} ${line}`)
    if (lines.length > KEEP) lines = lines.slice(-KEEP)
    timer ??= setTimeout(flush, level === 'error' ? 0 : FLUSH_MS)
  })

  const handlers = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler(): (error: unknown, fatal?: boolean) => void
      setGlobalHandler(handler: (error: unknown, fatal?: boolean) => void): void
    }
  }
  const errors = handlers.ErrorUtils
  if (errors) {
    const previous = errors.getGlobalHandler()
    errors.setGlobalHandler((error, fatal) => {
      log.error('erro', fatal ? 'erro fatal' : 'erro sem tratamento', {
        erro: error instanceof Error ? error.message : String(error),
      })
      flush()
      previous(error, fatal)
    })
  }

  log.info('app', 'aberto', { versao: version })
}

/** The lines kept, oldest first, for sharing. */
export function diagnosticsText(): string {
  return lines.join('\n')
}
