/**
 * Joining two edits of the same file.
 *
 * Text merges line by line against the version both devices last agreed on, as
 * git does: changes to different parts both survive. Only when both touched the
 * same lines is there no merge, and the caller keeps a conflict copy.
 *
 * The state files of HTML pages are JSON maps and merge key by key.
 */

import { diff3Merge } from 'node-diff3'

/** Splits keeping line endings, so the merged text has the endings it had. */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** The merged text, or null when both sides changed the same lines differently. */
export function mergeText(base: string, local: string, remote: string): string | null {
  if (local === remote) return local
  if (local === base) return remote
  if (remote === base) return local
  const blocks = diff3Merge(lines(local), lines(base), lines(remote), {
    excludeFalseConflicts: true,
  })
  let out = ''
  for (const block of blocks) {
    if ('ok' in block && block.ok) out += block.ok.join('')
    else if ('conflict' in block && block.conflict) {
      const { a, b } = block.conflict
      // The same text added on both sides is not a conflict.
      if (a.join('') === b.join('')) out += a.join('')
      else return null
    }
  }
  return out
}

/**
 * `.markdown-viewer/state/*.json`: what each side set wins for its keys; a key
 * both changed differently takes the local value, which is the newer edit, since
 * it has not reached anyone yet.
 */
export function mergeState(base: string, local: string, remote: string): string | null {
  type State = { version?: number; localStorage?: Record<string, string> }
  let b: State, l: State, r: State
  try {
    b = JSON.parse(base || '{}') as State
    l = JSON.parse(local) as State
    r = JSON.parse(remote) as State
  } catch {
    return null
  }
  const bs = b.localStorage ?? {}
  const ls = l.localStorage ?? {}
  const rs = r.localStorage ?? {}
  const merged: Record<string, string> = {}
  for (const key of new Set([...Object.keys(bs), ...Object.keys(ls), ...Object.keys(rs)])) {
    const inBase = key in bs
    const localChanged = ls[key] !== bs[key]
    const remoteChanged = rs[key] !== bs[key]
    const value = localChanged ? ls[key] : remoteChanged ? rs[key] : bs[key]
    // Removed on the side that changed it: gone. Kept untouched elsewhere: stays.
    if (value === undefined) {
      if (!inBase) continue
      continue
    }
    merged[key] = value
  }
  return JSON.stringify({ version: 1, localStorage: merged }, null, 2) + '\n'
}
