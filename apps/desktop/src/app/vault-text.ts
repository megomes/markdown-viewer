/**
 * The text of every note in a base, read once per index and kept for searching.
 *
 * The index holds what notes say about themselves but not their text, which
 * would double the memory a vault takes. The search reads it the first time it
 * runs, in batches. When the index is rebuilt (every rename, move or change on
 * the disk) only the files whose size or date changed are read again.
 */

import { readingStamp, type BaseIndex } from '@markdown-viewer/core/base-index'
import { timed } from '@markdown-viewer/core/log'
import type { SearchDoc } from '@markdown-viewer/core/search'
import { htmlText } from '@markdown-viewer/core/html'
import { fileSystem } from '~/platform'

const cache = new WeakMap<BaseIndex, Promise<SearchDoc[]>>()
/** The text of each file as last read, with the stamp it was read at. */
const texts = new Map<string, { stamp: string; text: string }>()
const BATCH = 16

export function searchDocs(index: BaseIndex): Promise<SearchDoc[]> {
  let pending = cache.get(index)
  if (!pending) {
    pending = timed(
      'busca',
      'ler o texto das notas',
      async () => {
        const files = Object.values(index.files)
        const docs: SearchDoc[] = []
        for (let start = 0; start < files.length; start += BATCH) {
          await Promise.all(
            files.slice(start, start + BATCH).map(async (file) => {
              try {
                const key = file.baseId + '\0' + file.path
                const stamp = readingStamp(file.baseId, file.path)
                let text = stamp ? texts.get(key)?.stamp === stamp && texts.get(key)!.text : false
                if (text === false || text === undefined) {
                  text = (await fileSystem().read(file.baseId, file.path)).text
                  if (stamp) texts.set(key, { stamp, text })
                }
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
      },
      { slowMs: 300, fields: { notas: Object.keys(index.files).length } },
    )
    cache.set(index, pending)
  }
  return pending
}
