/**
 * The text of every note in a base, read once per index and kept for searching.
 *
 * The index holds what notes say about themselves but not their text, which
 * would double the memory a vault takes. The search reads it the first time it
 * runs, in batches, and keeps it until the index is rebuilt.
 */

import type { BaseIndex } from '@markdown-viewer/core/base-index'
import type { SearchDoc } from '@markdown-viewer/core/search'
import { htmlText } from '@markdown-viewer/core/html'
import { fileSystem } from '~/platform'

const cache = new WeakMap<BaseIndex, Promise<SearchDoc[]>>()
const BATCH = 16

export function searchDocs(index: BaseIndex): Promise<SearchDoc[]> {
  let pending = cache.get(index)
  if (!pending) {
    pending = (async () => {
      const files = Object.values(index.files)
      const docs: SearchDoc[] = []
      for (let start = 0; start < files.length; start += BATCH) {
        await Promise.all(
          files.slice(start, start + BATCH).map(async (file) => {
            try {
              const { text } = await fileSystem().read(file.baseId, file.path)
              docs.push({
                path: file.path,
                title: file.title,
                text: /\.html?$/i.test(file.path) ? htmlText(text) : text,
                tags: file.tags,
                aliases: file.aliases,
              })
            } catch {
              // unreadable this time: left out of the results
            }
          }),
        )
      }
      return docs
    })()
    cache.set(index, pending)
  }
  return pending
}
