/**
 * Icons of folders and files, the part the desktop and the phone share.
 *
 * The names are the ones Iconize (`obsidian-icon-folder`) stores, so a vault
 * that came from Obsidian keeps its icons: `LiBookOpen` is Lucide's `book-open`,
 * and anything else is drawn as text, which covers emoji.
 *
 * The app keeps its own file, `.markdown-viewer/icons.json`, a map of path to
 * name. It is born as a copy of what Iconize had, the first time an icon is
 * changed here, and from then on it is the one that counts. It travels with the
 * sync, so every device shows the same icons.
 */

export const ICONS_FILE = '.markdown-viewer/icons.json'
export const ICONIZE_FILE = '.obsidian/plugins/obsidian-icon-folder/data.json'

/** Path in the vault to icon name. */
export type IconMap = Record<string, string>

/** `LiBookOpen` to `book-open`, `LiPlane` to `plane`. Null for what is not a Lucide name. */
export function lucideName(name: string): string | null {
  if (!name.startsWith('Li')) return null
  return name
    .slice(2)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z])([0-9])/g, '$1-$2')
    .toLowerCase()
}

/** `book-open` to `LiBookOpen`: the name as Iconize writes it. */
export function iconizeName(lucide: string): string {
  return (
    'Li' +
    lucide
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
  )
}

function strings(data: unknown): IconMap {
  const out: IconMap = {}
  if (!data || typeof data !== 'object') return out
  for (const [path, icon] of Object.entries(data as Record<string, unknown>)) {
    if (typeof icon === 'string' && icon) out[path] = icon
  }
  return out
}

/** What Iconize has: `path: name` pairs beside its own `settings`. */
export function parseIconize(text: string): IconMap {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    const { settings: _settings, ...paths } = data
    return strings(paths)
  } catch {
    return {}
  }
}

/** The app's own file. Null when there is none yet, which is not the same as empty. */
export function parseIcons(text: string): IconMap | null {
  try {
    const data = JSON.parse(text) as { icons?: unknown } | null
    return data && typeof data === 'object' && data.icons ? strings(data.icons) : null
  } catch {
    return null
  }
}

export function serializeIcons(icons: IconMap): string {
  const sorted: IconMap = {}
  for (const path of Object.keys(icons).sort()) sorted[path] = icons[path]!
  return JSON.stringify({ icons: sorted }, null, 2) + '\n'
}

/** The icons after a file or a folder went from one path to another, with all inside it. */
export function iconsAfterMove(icons: IconMap, from: string, to: string): IconMap {
  let changed = false
  const out: IconMap = {}
  for (const [path, icon] of Object.entries(icons)) {
    if (path === from || path.startsWith(from + '/')) {
      out[to + path.slice(from.length)] = icon
      changed = true
    } else out[path] = icon
  }
  return changed ? out : icons
}

/** The icons after a file or a folder was removed. */
export function iconsAfterRemove(icons: IconMap, gone: string): IconMap {
  const kept = Object.entries(icons).filter(
    ([path]) => path !== gone && !path.startsWith(gone + '/'),
  )
  return kept.length === Object.keys(icons).length ? icons : Object.fromEntries(kept)
}
