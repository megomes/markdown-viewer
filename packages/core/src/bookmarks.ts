/**
 * Obsidian's favourites (`.obsidian/bookmarks.json`), read and written in its
 * own format so that Obsidian and this app keep seeing the same list. Only
 * files are dealt with here; groups, searches and headings are kept as they are.
 */

export const BOOKMARKS_FILE = '.obsidian/bookmarks.json'

interface Item {
  type?: string
  ctime?: number
  path?: string
  title?: string
  items?: Item[]
}

export interface BookmarkedFile {
  path: string
  title: string
}

function parse(text: string | null): { items?: Item[] } & Record<string, unknown> {
  if (!text) return { items: [] }
  try {
    const data = JSON.parse(text) as unknown
    return data && typeof data === 'object' ? (data as { items?: Item[] }) : { items: [] }
  } catch {
    return { items: [] }
  }
}

/** The files bookmarked, groups flattened, in the order Obsidian shows them. */
export function bookmarkedFiles(text: string | null): BookmarkedFile[] {
  const out: BookmarkedFile[] = []
  const walk = (items: Item[]) => {
    for (const item of items) {
      if (item.type === 'group' && item.items) walk(item.items)
      else if (item.type === 'file' && item.path) {
        out.push({
          path: item.path,
          title:
            item.title ||
            item.path.slice(item.path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, ''),
        })
      }
    }
  }
  walk(parse(text).items ?? [])
  return out
}

/**
 * The file's text with `path` bookmarked, or taken out if it already was (in
 * whichever group it sits). Everything else in the file stays as it was.
 */
export function toggleBookmark(text: string | null, path: string, now = Date.now()): string {
  const data = parse(text)
  const items = data.items ?? []
  const remove = (list: Item[]): boolean => {
    const at = list.findIndex((item) => item.type === 'file' && item.path === path)
    if (at >= 0) {
      list.splice(at, 1)
      return true
    }
    return list.some((item) => item.type === 'group' && item.items && remove(item.items))
  }
  if (!remove(items)) items.push({ type: 'file', ctime: now, path })
  data.items = items
  return JSON.stringify(data, null, 2)
}

/** The link that opens the file in Obsidian: `obsidian://open?vault=…&file=…`. */
export function obsidianUrl(vaultName: string, path: string): string {
  return (
    'obsidian://open?vault=' +
    encodeURIComponent(vaultName) +
    '&file=' +
    encodeURIComponent(path.replace(/\.md$/i, ''))
  )
}
