/**
 * What an HTML page kept in `localStorage`, stored as a file in the vault.
 *
 * The page runs in an isolated frame with no storage of its own. Its
 * `localStorage` is replaced by one that reports every change here, and here it
 * is written to `.markdown-viewer/state/<caminho do arquivo>.json`. Being a file
 * in the vault is what lets the sync carry a tracker's progress to every device.
 */

import { encode } from '@markdown-viewer/core/text'
import { fileSystem } from '~/platform'

export const STATE_FOLDER = '.markdown-viewer/state'

export function statePath(path: string): string {
  return `${STATE_FOLDER}/${path}.json`
}

interface StateFile {
  version: 1
  localStorage: Record<string, string>
}

export async function readHtmlState(baseId: string, path: string): Promise<Record<string, string>> {
  try {
    const { text } = await fileSystem().read(baseId, statePath(path))
    const data = JSON.parse(text) as Partial<StateFile>
    return data.localStorage && typeof data.localStorage === 'object' ? data.localStorage : {}
  } catch {
    return {}
  }
}

async function ensureFolder(baseId: string, folder: string): Promise<void> {
  let at = ''
  for (const segment of folder.split('/')) {
    at = at ? at + '/' + segment : segment
    try {
      if (!(await fileSystem().stat(baseId, at))) await fileSystem().createFolder(baseId, at)
    } catch {
      // Already there, or created by a write a moment ago.
    }
  }
}

export async function writeHtmlState(
  baseId: string,
  path: string,
  storage: Record<string, string>,
): Promise<void> {
  const target = statePath(path)
  await ensureFolder(baseId, target.slice(0, target.lastIndexOf('/')))
  const file: StateFile = { version: 1, localStorage: storage }
  const text = JSON.stringify(file, null, 2) + '\n'
  await fileSystem().write(
    baseId,
    target,
    encode(text, { eol: '\n', bom: false, encoding: 'utf-8', lossy: false }),
  )
}
