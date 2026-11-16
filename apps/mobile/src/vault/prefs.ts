/**
 * What this phone remembers that is not the vault: the notes pinned to the
 * widget and where a quick capture goes. It stays on the device, like the
 * widget itself; another phone pins its own.
 */

import { File, Paths } from 'expo-file-system'

export interface Prefs {
  /** File ids of the notes pinned to the widget, in the order they were pinned. */
  pins: string[]
  /** The folder a quick capture is saved in, or null for the one the app picks. */
  captureFolder: string | null
}

const EMPTY: Prefs = { pins: [], captureFolder: null }
const prefsFile = new File(Paths.document, 'prefs.json')

export async function loadPrefs(): Promise<Prefs> {
  try {
    if (!prefsFile.exists) return EMPTY
    const data = JSON.parse(await prefsFile.text()) as Partial<Prefs> | null
    return {
      pins: Array.isArray(data?.pins) ? data.pins.filter((id) => typeof id === 'string') : [],
      captureFolder: typeof data?.captureFolder === 'string' ? data.captureFolder : null,
    }
  } catch {
    return EMPTY
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  if (!prefsFile.exists) prefsFile.create()
  await prefsFile.write(JSON.stringify(prefs))
}

export function wipePrefs(): void {
  if (prefsFile.exists) prefsFile.delete()
}
