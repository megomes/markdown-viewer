/**
 * Search in the text of the notes, with the desktop's query language
 * (`@markdown-viewer/core/search`): words in any order, `"frase"`, `#tag`,
 * `path:Pasta`, `-palavra`.
 *
 * The text of each note is read from the device once and kept while the note
 * does not change (by its hash), so the first search reads the vault and the
 * next ones answer at once. Files not on the device are searched by name only.
 */

import { search, type SearchDoc, type SearchResult } from '@markdown-viewer/core/search'
import { htmlText } from '@markdown-viewer/core/html'
import { decode } from '@markdown-viewer/core/text'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import type { MirrorFile } from '@markdown-viewer/sync/mirror'
import { PhoneFiles } from './storage'

const files = new PhoneFiles()
const texts = new Map<string, { hash: string; text: string }>()
/** Read at once: enough to keep the disk busy, few enough to leave the screen alone. */
const BATCH = 16

const yieldToScreen = () => new Promise<void>((done) => setTimeout(done, 0))

async function textOf(file: MirrorFile): Promise<string> {
  const known = texts.get(file.path)
  if (known?.hash === file.hash) return known.text
  if (!file.local) return ''
  try {
    const raw = decode(await files.read(file.path)).text
    const text = /\.html?$/i.test(file.path) ? htmlText(raw) : raw
    texts.set(file.path, { hash: file.hash, text })
    return text
  } catch {
    return ''
  }
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
        docs.push({
          path: entry.path,
          title: entry.title,
          text: await textOf(file),
          tags: entry.tags,
          aliases: entry.aliases,
        })
      }),
    )
    // Taps keep answering while the vault is read the first time.
    await yieldToScreen()
  }
  return search(query, docs, 100)
}
