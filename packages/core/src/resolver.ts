/**
 * Which file a link points at, decided the way Obsidian decides it.
 *
 * - `./a` and `../a` are relative to the note that holds the link.
 * - A link with a path is tried from the root of the vault, and then as the end of
 *   a longer path: `[[Docs/Manual]]` finds `Flight Sim/DCS/Docs/Manual.md`.
 * - A bare name is looked up by file name anywhere in the vault. When several
 *   files share it, the one beside the note wins, then the one with the shortest
 *   path, which is what "shortest path when possible" writes in the first place.
 * - A name without an extension means the Markdown note of that name.
 * - Case does not matter, as it does not on the disks the vault lives on.
 * - Then the name is tried against every note's `aliases`.
 * - Last, and here only, a name with no extension also finds `name.html`. Notes in
 *   this vault get rewritten as HTML pages, and the links to them stay as they were.
 */

export interface Resolver {
  /** The vault path the link leads to, or null when nothing matches. */
  resolve(target: string, fromPath: string): string | null
  /** Whether a path exists in the vault. */
  has(path: string): boolean
}

const NOTE_EXTENSIONS = ['.md', '.markdown']

function extensionOf(name: string): string {
  const slash = name.lastIndexOf('/')
  const dot = name.lastIndexOf('.')
  return dot > slash + 0 && dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** `a/b/../c.md` becomes `a/c.md`. Leading `..` past the root are dropped. */
export function normalizePath(path: string): string {
  const out: string[] = []
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function createResolver(
  paths: Iterable<string>,
  aliases: Iterable<[alias: string, path: string]> = [],
): Resolver {
  const exact = new Map<string, string>()
  const byName = new Map<string, string[]>()

  const addName = (key: string, path: string) => {
    const list = byName.get(key)
    if (list) list.push(path)
    else byName.set(key, [path])
  }

  for (const path of paths) {
    const lower = path.toLowerCase()
    exact.set(lower, path)
    const name = baseNameOf(lower)
    addName(name, path)
    const ext = extensionOf(name)
    // A note is also known by its name without the extension.
    if (NOTE_EXTENSIONS.includes(ext)) {
      addName(name.slice(0, -ext.length), path)
      exact.set(lower.slice(0, -ext.length), path)
    }
  }

  const byAlias = new Map<string, string>()
  for (const [alias, path] of aliases) {
    const key = alias.trim().toLowerCase()
    if (key && !byAlias.has(key)) byAlias.set(key, path)
  }

  const pick = (candidates: string[], fromPath: string): string => {
    if (candidates.length === 1) return candidates[0]!
    const here = folderOf(fromPath)
    const beside = candidates.find((path) => folderOf(path) === here)
    if (beside) return beside
    return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!
  }

  function resolve(rawTarget: string, fromPath: string): string | null {
    const target = rawTarget.trim().replaceAll('\\', '/')
    if (!target) return fromPath || null
    const lower = target.toLowerCase()

    if (lower.startsWith('./') || lower.startsWith('../')) {
      const joined = normalizePath(folderOf(fromPath.toLowerCase()) + '/' + lower)
      return exact.get(joined) ?? null
    }

    const clean = normalizePath(lower)
    const direct =
      exact.get(clean) ?? exact.get(normalizePath(folderOf(fromPath.toLowerCase()) + '/' + clean))
    if (direct) return direct

    const name = baseNameOf(clean)
    const candidates = byName.get(name)
    if (candidates?.length) {
      const fitting = clean.includes('/')
        ? candidates.filter((path) => {
            const lowerPath = path.toLowerCase()
            const stem = NOTE_EXTENSIONS.includes(extensionOf(lowerPath))
              ? lowerPath.slice(0, -extensionOf(lowerPath).length)
              : lowerPath
            return stem.endsWith('/' + clean) || lowerPath.endsWith('/' + clean) || stem === clean
          })
        : candidates
      if (fitting.length) return pick(fitting, fromPath)
    }

    const alias = byAlias.get(clean) ?? byAlias.get(lower)
    if (alias) return alias

    // Past Obsidian: a name with no extension that only exists as an HTML page.
    if (!extensionOf(baseNameOf(clean))) return resolve(target + '.html', fromPath)
    return null
  }

  return { resolve, has: (path) => exact.has(path.toLowerCase()) }
}
