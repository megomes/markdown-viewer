/**
 * The icons of folders and files of a base: read from the app's own file, or
 * from Iconize's while the app has none, and written to the app's own when one
 * is chosen here (`@markdown-viewer/core/icons` says why).
 */

import {
  ICONIZE_FILE,
  ICONS_FILE,
  parseIconize,
  parseIcons,
  serializeIcons,
  type IconMap,
} from '@markdown-viewer/core/icons'
import { fileSystem } from '~/platform'

async function text(baseId: string, path: string): Promise<string | null> {
  try {
    return (await fileSystem().read(baseId, path)).text
  } catch {
    return null
  }
}

/** Path to icon name, for one base. Empty when the base has no icons at all. */
export async function readFolderIcons(baseId: string): Promise<IconMap> {
  const own = await text(baseId, ICONS_FILE)
  const icons = own === null ? null : parseIcons(own)
  if (icons) return icons
  const iconize = await text(baseId, ICONIZE_FILE)
  return iconize === null ? {} : parseIconize(iconize)
}

/** Writes the whole map to the app's own file, which from then on is the one read. */
export async function saveFolderIcons(baseId: string, icons: IconMap): Promise<void> {
  const files = fileSystem()
  await files.createFolder(baseId, '.markdown-viewer').catch(() => {})
  await files.write(baseId, ICONS_FILE, new TextEncoder().encode(serializeIcons(icons)))
}
