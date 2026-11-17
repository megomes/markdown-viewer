/**
 * Obsidian's bookmarks (`.obsidian/bookmarks.json`), read so the favourites the
 * vault already has show up here, and written so that "Favoritar" in the tree's
 * menu shows up in Obsidian too. The format lives in `@markdown-viewer/core`.
 */

import {
  BOOKMARKS_FILE,
  bookmarkedFiles,
  toggleBookmark as toggled,
} from '@markdown-viewer/core/bookmarks'
import { fileSystem } from '~/platform'

export interface Bookmark {
  baseId: string
  path: string
  title: string
}

async function readText(baseId: string): Promise<string | null> {
  try {
    return (await fileSystem().read(baseId, BOOKMARKS_FILE)).text
  } catch {
    return null
  }
}

export async function readBookmarks(baseId: string): Promise<Bookmark[]> {
  return bookmarkedFiles(await readText(baseId)).map((file) => ({ baseId, ...file }))
}

/** Adds the file to the favourites, or takes it out. Resolves to the new list of that base. */
export async function toggleBookmark(baseId: string, path: string): Promise<Bookmark[]> {
  const text = toggled(await readText(baseId), path)
  await fileSystem().write(baseId, BOOKMARKS_FILE, new TextEncoder().encode(text))
  return readBookmarks(baseId)
}

export function isBookmarked(list: Bookmark[], baseId: string, path: string): boolean {
  return list.some((bookmark) => bookmark.baseId === baseId && bookmark.path === path)
}
