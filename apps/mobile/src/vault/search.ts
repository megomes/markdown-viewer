/**
 * Search in the text of the notes, with the desktop's query language
 * (`@markdown-viewer/core/search`): words in any order, `"frase"`, `#tag`,
 * `path:Pasta`, `-palavra`.
 *
 * The text of each note is read from the device once and kept while the note
 * does not change (by its hash), so the first search reads the vault and the
 * next ones answer at once. Files not on the device are searched by name only.
 */

import { fold, search, type SearchDoc, type SearchResult } from '@markdown-viewer/core/search'
import { htmlText } from '@markdown-viewer/core/html'
import { decode } from '@markdown-viewer/core/text'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import type { MirrorFile } from '@markdown-viewer/sync/mirror'
import { PhoneFiles } from './storage'

const files = new PhoneFiles()
const texts = new Map<string, { hash: string; text: string; folded: string }>()
/** Read at once: enough to keep the disk busy, few enough to leave the screen alone. */
const BATCH = 16

const yieldToScreen = () => new Promise<void>((done) => setTimeout(done, 0))

const EMPTY = { text: '', folded: '' }

/** The note's text, and the same without accents or capitals, read once per version. */
async function textOf(file: MirrorFile): Promise<{ text: string; folded: string }> {
  const known = texts.get(file.path)
  if (known?.hash === file.hash) return known
  if (!file.local) return EMPTY
  try {
    const raw = decode(await files.read(file.path)).text
    const text = /\.html?$/i.test(file.path) ? htmlText(raw) : raw
    const entry = { hash: file.hash, text, folded: fold(text) }
    texts.set(file.path, entry)
    return entry
  } catch {
    return EMPTY
  }
}

/** Reads the notes ahead, while the person is still typing the first search. */
export async function warmSearch(index: BaseIndex, catalog: MirrorFile[]): Promise<void> {
  await searchVault('', index, catalog)
}

export async function searchVault(
  query: string,
  index: BaseIndex,
  catalog: MirrorFile[],
): Promise<SearchResult[]> {
  const byPath = new Map(catalog.map((file) => [file.path, file]))
  const docs: SearchDoc[] = []
  const entries = Object.values(index.files)
  for (let start = 0; start < entries.length; start += BATCH) {
    await Promise.all(
      entries.slice(start, start + BATCH).map(async (entry) => {
        const file = byPath.get(entry.path)
        if (!file) return
        const { text, folded } = await textOf(file)
        docs.push({
          path: entry.path,
          title: entry.title,
          text,
          folded,
          tags: entry.tags,
          aliases: entry.aliases,
        })
      }),
    )
    // Taps keep answering while the vault is read the first time.
    await yieldToScreen()
  }
  return query ? search(query, docs, 100) : []
}
