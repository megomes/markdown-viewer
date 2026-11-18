/**
 * Looking for a new version, and putting it in place.
 *
 * Only the desktop build has anywhere to install to, so in the browser every
 * call here answers that there is nothing, and the interface draws nothing.
 *
 * Looking is allowed to fail quietly. There is no network on a plane, the
 * repository may not have a release yet, and none of that is worth a message
 * over a document someone is writing. Installing is not: by then the person
 * asked for it and is waiting, so a failure has to reach them.
 */

import { advance, NOT_STARTED, type Download, type DownloadEvent } from '~/app/updates'
import { log } from '@markdown-viewer/core/log'
import { isDesktop } from '.'

export interface PendingUpdate {
  /** The version being offered, as the release names it. */
  version: string
  /** Downloads and installs it, reporting progress as the bytes land. */
  install: (watch: (download: Download) => void) => Promise<void>
}

/**
 * The new version on offer, or nothing when there is none to be had. A failure
 * is quiet here (the look on opening) but goes to the log.
 */
export async function lookForUpdate(): Promise<PendingUpdate | null> {
  try {
    return await searchForUpdate()
  } catch (error) {
    log.warn('atualizacao', 'busca falhou', { motivo: messageOf(error) })
    return null
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The same, for "Buscar atualização": a failure is thrown, so the button can
 * say that the search failed instead of "nenhuma versão nova".
 */
export async function searchForUpdate(): Promise<PendingUpdate | null> {
  if (!isDesktop()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const found = await check()
  if (!found) return null

  return {
    version: found.version,
    install: async (watch) => {
      // The updater reports each chunk as it lands and never the sum, so the
      // running total is kept here and handed over whole.
      let download = NOT_STARTED
      await found.downloadAndInstall((event) => {
        download = advance(download, event as DownloadEvent)
        watch(download)
      })
    },
  }
}

/**
 * Hands a version found by hand (Ajustes > Buscar atualização) to the notice
 * that offers it, so installing goes through the one place that does it.
 */
const FOUND = 'markdown-viewer:update-found'

export function offerUpdate(update: PendingUpdate): void {
  window.dispatchEvent(new CustomEvent<PendingUpdate>(FOUND, { detail: update }))
}

export function onUpdateOffered(handle: (update: PendingUpdate) => void): () => void {
  const listener = (event: Event) => handle((event as CustomEvent<PendingUpdate>).detail)
  window.addEventListener(FOUND, listener)
  return () => window.removeEventListener(FOUND, listener)
}

/** Closes the app and opens it again, now on the version just installed. */
export async function restart(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}
