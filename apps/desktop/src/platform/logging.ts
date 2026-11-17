/**
 * Where the desktop's log lines go (`@markdown-viewer/core/log`): the console,
 * and on the desktop also the rotating file of Tauri's log plugin, beside what
 * Rust writes there. On Windows the file is
 * `%LOCALAPPDATA%\<identifier>\logs\markdown-viewer.log`.
 *
 * Besides what the app logs on purpose, three things are caught here because
 * they are what "it is slow" or "it broke" looks like from the outside:
 * errors nobody caught, promises that failed with nobody listening, and long
 * tasks, the moments the interface could not answer a click.
 */

import { currentWork, log, setLogSink, type LogLevel } from '@markdown-viewer/core/log'
import { isDesktop } from '.'

/** Below this a long task is ordinary; past it the window felt stuck. */
const LONG_TASK_MS = 200
/** At most this many long tasks are logged a minute, so a bad stretch does not flood the file. */
const LONG_TASKS_PER_MINUTE = 20

export function startLogging(role: string): void {
  if (isDesktop()) {
    const writer = import('@tauri-apps/plugin-log')
    setLogSink((level: LogLevel, line: string) => {
      const text = `{${role}} ${line}`
      // oxlint-disable-next-line no-console
      ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(text)
      void writer.then((plugin) => plugin[level](text)).catch(() => {})
    })
  }

  window.addEventListener('error', (event) => {
    log.error('erro', event.message || 'erro sem mensagem', {
      onde: event.filename ? `${event.filename}:${event.lineno}` : undefined,
      durante: currentWork() ?? undefined,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown
    log.error('erro', 'promessa recusada sem tratamento', {
      motivo: reason instanceof Error ? reason.message : String(reason),
      durante: currentWork() ?? undefined,
    })
  })

  try {
    let minute = 0
    let count = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_TASK_MS) continue
        const now = Math.floor(performance.now() / 60_000)
        if (now !== minute) {
          minute = now
          count = 0
        }
        if (++count > LONG_TASKS_PER_MINUTE) continue
        log.warn('travada', 'a interface ficou sem responder', {
          ms: Math.round(entry.duration),
          durante: currentWork() ?? undefined,
        })
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // A web view without long task timing (WebKit) just goes without.
  }

  log.info('app', 'janela aberta', { versao: __APP_VERSION__, janela: role })
}
