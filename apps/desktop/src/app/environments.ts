/**
 * Environments: the folders at the root of the vault, each a world of its own
 * (personal notes, work). Choosing one roots the tree there and keeps its own
 * tabs, search and quick open; links between environments go on working, since
 * it is all one vault and one sync.
 *
 * Which root folders are environments, and the colour of each, live in a file
 * inside the vault (`.markdown-viewer/environments.json`), so they travel with
 * the sync and the phone shows the same ones.
 */

import type { Entry } from '@markdown-viewer/core/fs'
import {
  accentOf,
  environmentsOf as foldersOf,
  parseEnvironments,
  type EnvironmentsConfig,
} from '@markdown-viewer/core/environments'
import { fileSystem } from '~/platform'

export { ACCENTS, accentOf } from '@markdown-viewer/core/environments'
export type { Accent, EnvironmentsConfig } from '@markdown-viewer/core/environments'

export const ENVIRONMENTS_FILE = '.markdown-viewer/environments.json'
const KNOWN_KEY = 'markdown-viewer.environments'

export async function readEnvironments(baseId: string): Promise<EnvironmentsConfig> {
  try {
    return parseEnvironments((await fileSystem().read(baseId, ENVIRONMENTS_FILE)).text)
  } catch {
    return parseEnvironments('')
  }
}

export async function saveEnvironments(baseId: string, config: EnvironmentsConfig): Promise<void> {
  const files = fileSystem()
  // Its folder may not be there yet. Making one that exists is refused, and that is fine.
  await files.createFolder(baseId, '.markdown-viewer').catch(() => {})
  await files.write(
    baseId,
    ENVIRONMENTS_FILE,
    new TextEncoder().encode(JSON.stringify(config, null, 2) + '\n'),
  )
}

/** The environments of a vault, from what sits at its root. */
export function environmentsOf(roots: Entry[] | undefined, config: EnvironmentsConfig): string[] {
  return foldersOf(
    (roots ?? []).filter((entry) => entry.kind === 'directory').map((entry) => entry.name),
    config,
  )
}

/**
 * The environments as they were when the app last ran. The root of the vault is
 * read a moment after the window opens, and until then the tabs coming back
 * from the last session would all look like they belonged to no environment.
 */
export function knownEnvironments(): string[] {
  try {
    const known = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as unknown
    return Array.isArray(known) ? known.filter((one) => typeof one === 'string') : []
  } catch {
    return []
  }
}

export function rememberEnvironments(folders: string[]): void {
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify(folders))
  } catch {
    // storage blocked
  }
}

/** Which environment a path of the vault is in, or null when in none. */
export function environmentOfPath(path: string, folders: string[]): string | null {
  const slash = path.indexOf('/')
  const root = slash < 0 ? path : path.slice(0, slash)
  return slash >= 0 && folders.includes(root) ? root : null
}

export function colorOf(config: EnvironmentsConfig, folder: string) {
  return accentOf(config.colors[folder])
}
