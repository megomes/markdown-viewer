/**
 * Comments on Markdown notes, kept where the Revisor keeps its own: under
 * `rv_state` in `.markdown-viewer/state/<nota>.json`. Same shape, same file
 * place, so the MCP, the export and the sync treat both alike.
 */

import { encode } from '@markdown-viewer/core/text'
import { noteItem, readReview, writeReview, type ReviewState } from '@markdown-viewer/core/review'
import { fileSystem } from '~/platform'
import { statePath, STATE_FOLDER } from './html-state'

const listeners = new Set<() => void>()

/** Lets a panel redraw when a comment is added or removed. */
export function onNoteComments(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function readText(baseId: string, path: string): Promise<string | null> {
  try {
    return (await fileSystem().read(baseId, statePath(path))).text
  } catch {
    return null
  }
}

async function ensureFolders(baseId: string, path: string): Promise<void> {
  const target = statePath(path)
  let at = ''
  for (const segment of target.slice(0, target.lastIndexOf('/')).split('/')) {
    at = at ? at + '/' + segment : segment
    try {
      if (!(await fileSystem().stat(baseId, at))) await fileSystem().createFolder(baseId, at)
    } catch {
      // already there
    }
  }
}

async function save(baseId: string, path: string, before: string | null, review: ReviewState) {
  await ensureFolders(baseId, path)
  await fileSystem().write(
    baseId,
    statePath(path),
    encode(writeReview(before, review), { eol: '\n', bom: false, encoding: 'utf-8', lossy: false }),
  )
  for (const listener of listeners) listener()
}

export async function readNoteComments(baseId: string, path: string): Promise<ReviewState | null> {
  const text = await readText(baseId, path)
  return text ? readReview(text) : null
}

export async function addNoteComment(
  baseId: string,
  path: string,
  options: {
    title: string
    selected: string
    context: string | null
    section: string
    comment: string
  },
): Promise<void> {
  const before = await readText(baseId, path)
  await save(baseId, path, before, noteItem(before ? readReview(before) : null, options))
}

export async function removeNoteComment(baseId: string, path: string, id: string): Promise<void> {
  const before = await readText(baseId, path)
  const review = before ? readReview(before) : null
  if (!review) return
  await save(baseId, path, before, {
    ...review,
    items: review.items.filter((item) => item.id !== id),
  })
}

export { STATE_FOLDER }
