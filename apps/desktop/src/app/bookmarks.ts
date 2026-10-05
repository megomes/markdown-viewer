/**
 * Obsidian's bookmarks (`.obsidian/bookmarks.json`), read so the favourites the
 * vault already has show up here. Groups are flattened; searches and headings
 * are left out, since there is nothing here yet that would open them.
 */

import { fileSystem } from '~/platform'

export interface Bookmark {
  baseId: string
  path: string
  title: string
}

interface Item {
  type?: string
  path?: string
  title?: string
  items?: Item[]
}

function flatten(items: Item[], into: Item[]): void {
  for (const item of items) {
    if (item.type === 'group' && item.items) flatten(item.items, into)
    else if (item.type === 'file' && item.path) into.push(item)
  }
}

export async function readBookmarks(baseId: string): Promise<Bookmark[]> {
  try {
    const { text } = await fileSystem().read(baseId, '.obsidian/bookmarks.json')
    const data = JSON.parse(text) as { items?: Item[] }
    const files: Item[] = []
    flatten(data.items ?? [], files)
    return files.map((item) => ({
      baseId,
      path: item.path!,
      title:
        item.title ||
        item.path!.slice(item.path!.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, ''),
    }))
  } catch {
    return []
  }
}
