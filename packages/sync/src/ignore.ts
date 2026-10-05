/**
 * What stays out of the sync: tool folders, system junk, and whatever the vault
 * lists in `.markdown-viewer/ignore`, one pattern per line in `.gitignore` style
 * (`pasta/`, `*.tmp`, `caminho/exato.md`, `#` for comments).
 */

export const DEFAULT_IGNORE = [
  '.git/',
  'node_modules/',
  '.trash/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  // Obsidian rewrites these on every click; syncing them is churn, not data.
  '.obsidian/workspace.json',
  '.obsidian/workspace-mobile.json',
  '.obsidian/cache',
]

export const IGNORE_FILE = '.markdown-viewer/ignore'

function toRegExp(pattern: string): RegExp {
  let p = pattern.trim()
  const directory = p.endsWith('/')
  if (directory) p = p.slice(0, -1)
  const anchored = p.startsWith('/') || p.includes('/')
  if (p.startsWith('/')) p = p.slice(1)
  const body = p
    .split('')
    .map((c) =>
      c === '*' ? '[^/]*' : c === '?' ? '[^/]' : /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c,
    )
    .join('')
    .replace(/\[\^\/\]\*\[\^\/\]\*/g, '.*') // ** spans folders
  const start = anchored ? '^' : '(^|/)'
  const end = directory ? '(/|$)' : '($|/)'
  return new RegExp(start + body + end)
}

export function ignoreMatcher(extra = ''): (path: string) => boolean {
  const patterns = [
    ...DEFAULT_IGNORE,
    ...extra
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  ].map(toRegExp)
  return (path) => patterns.some((re) => re.test(path))
}
