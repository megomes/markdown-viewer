/**
 * Folder icons from Iconize (`obsidian-icon-folder`), so the tree looks the way
 * it looked in Obsidian. The plugin keeps `path: "LiPlane"` pairs in its data
 * file; `Li` names are Lucide icons, anything else is an emoji.
 */

import { entryId } from '@markdown-viewer/core/fs'
import { fileSystem } from '~/platform'

const DATA = '.obsidian/plugins/obsidian-icon-folder/data.json'

/** Entry id to icon name, for one base. Empty when the plugin is not there. */
export async function readFolderIcons(baseId: string): Promise<Record<string, string>> {
  try {
    const { text } = await fileSystem().read(baseId, DATA)
    const data = JSON.parse(text) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [path, icon] of Object.entries(data)) {
      if (path === 'settings' || typeof icon !== 'string' || !icon) continue
      out[entryId(baseId, path)] = icon
    }
    return out
  } catch {
    return {}
  }
}
