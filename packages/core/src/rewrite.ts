/**
 * Rewrites links after a file or folder moves, as Obsidian does with "Automatically
 * update internal links" on.
 *
 * Only the target of each link changes. The `#Título`, the `|apelido`, the `!` of
 * an embed and everything around the link stay exactly as they were written.
 */

import { readLinks, type LinkRef } from './note'
import { normalizePath } from './resolver'

export interface MoveContext {
  /** Old vault path to new vault path, for every file that moved. */
  moved: Map<string, string>
  /** What a link resolved to before the move. */
  resolveBefore: (target: string, fromPath: string) => string | null
  /** Whether a file name is shared by more than one file after the move. */
  nameIsAmbiguous: (name: string) => boolean
}

const NOTE_EXT = /\.(md|markdown)$/i

function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** `a/b/c.md` seen from `a/x/n.md` is `../b/c.md`. */
export function relativePath(fromFile: string, toFile: string): string {
  const from = folderOf(fromFile).split('/').filter(Boolean)
  const to = toFile.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const up = from.slice(common).map(() => '..')
  return [...up, ...to.slice(common)].join('/')
}

function wikiTarget(link: LinkRef, newPath: string, ctx: MoveContext): string {
  const isNote = NOTE_EXT.test(newPath)
  const name = newPath.slice(newPath.lastIndexOf('/') + 1)
  const stem = isNote ? name.replace(NOTE_EXT, '') : name
  // Written with a folder, or a name two files now share: the full path, so
  // the link keeps pointing at the same file.
  if (link.target.includes('/') || ctx.nameIsAmbiguous(name)) {
    return isNote ? newPath.replace(NOTE_EXT, '') : newPath
  }
  return stem
}

function encodeLike(original: string, path: string): string {
  // Kept in the spelling the note already used: encoded spaces or plain.
  return /%20/.test(original) || !/[ ]/.test(original)
    ? path.split('/').map(encodeURIComponent).join('/')
    : path
}

function rebuild(text: string, link: LinkRef, newTarget: string): string {
  const raw = text.slice(link.from, link.to)
  if (link.kind === 'wikilink' || link.kind === 'embed') {
    const bang = link.kind === 'embed' ? '!' : ''
    const sub = link.subpath ? '#' + link.subpath : ''
    const display = link.display === null ? '' : '|' + link.display
    return `${bang}[[${newTarget}${sub}${display}]]`
  }
  // [texto](destino "título"): only the destination is replaced.
  const open = raw.indexOf('](')
  const head = raw.slice(0, open + 2)
  const rest = raw.slice(open + 2, -1)
  const angled = rest.trimStart().startsWith('<')
  const titleAt = angled ? rest.indexOf('>') + 1 : rest.search(/\s+"/)
  const tail = titleAt > 0 ? rest.slice(titleAt) : ''
  const oldDest = (titleAt > 0 ? rest.slice(0, titleAt) : rest).trim().replace(/^<|>$/g, '')
  const hash = oldDest.indexOf('#')
  const anchor = hash < 0 ? '' : oldDest.slice(hash)
  const dest = (angled ? newTarget : encodeLike(oldDest, newTarget)) + anchor
  return head + (angled ? `<${dest}>` : dest) + (angled ? tail.replace(/^>/, '') : tail) + ')'
}

/**
 * The note's text with every link to a moved file pointing at its new place, or
 * null when nothing in it changed. `notePath` is where the note lived before the
 * move, and `newNotePath` where it lives now, which differ when the note itself
 * moved and its relative links have to follow.
 */
export function rewriteLinks(
  text: string,
  notePath: string,
  newNotePath: string,
  ctx: MoveContext,
): string | null {
  const links = readLinks(text, 0)
  let out = ''
  let at = 0
  let changed = false

  for (const link of links) {
    if (!link.target) continue
    const before = ctx.resolveBefore(link.target, notePath)
    if (!before) continue
    const after = ctx.moved.get(before) ?? before
    const selfMoved = notePath !== newNotePath
    const isRelative = link.kind === 'markdown' || link.kind === 'markdown-image'
    if (after === before && !(selfMoved && isRelative)) continue

    let target: string
    if (isRelative) {
      // A Markdown link is a path from the note: recomputed from where both are now.
      const wasRooted = normalizePath(link.target) === before && !link.target.startsWith('.')
      target = wasRooted && !selfMoved ? after : relativePath(newNotePath, after)
      if (target === link.target) continue
    } else {
      target = wikiTarget(link, after, ctx)
    }

    out += text.slice(at, link.from) + rebuild(text, link, target)
    at = link.to
    changed = true
  }

  return changed ? out + text.slice(at) : null
}
