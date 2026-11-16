/**
 * What each file in a base links to, and who links back.
 *
 * The index is built in the background when a folder opens, and lives only in
 * memory: it is cheaper to read the files again next session than to keep a
 * cache that can quietly disagree with the disk.
 *
 * Links are pulled with regular expressions rather than by parsing every file.
 * Parsing a thousand notes to find their links costs seconds; reading them with
 * two patterns costs milliseconds, and a link inside a code fence being counted
 * is a smaller error than making somebody wait.
 */

import { entryId, isTextFile, type Entry, type FileSystem } from './fs'
import { htmlTitle } from './html'
import { readNote, type Heading } from './note'
import { createResolver, type Resolver } from './resolver'

/** The part of the filesystem port the index reads through. */
export type IndexSource = Pick<FileSystem, 'list' | 'stat' | 'read'>

export interface IndexedFile {
  baseId: string
  path: string
  name: string
  /** First heading of the file, or its name when it has none. */
  title: string
  /** Paths inside the base that this file points at, links and embeds alike. */
  links: string[]
  /** Paths of what the note embeds with `![[…]]` or `![](…)`, in order. */
  embeds: string[]
  aliases: string[]
  tags: string[]
  properties: Record<string, unknown>
  headings: Heading[]
  blockIds: string[]
}

export interface BaseIndex {
  files: Record<string, IndexedFile>
  /** Entry id of a file, to the entry ids of the files that point at it. */
  backlinks: Record<string, string[]>
  /** Every file in the base, notes or not, so embeds of images and PDFs resolve. */
  paths: string[]
  scanned: number
  total: number
  done: boolean
}

export const EMPTY_INDEX: BaseIndex = {
  files: {},
  backlinks: {},
  paths: [],
  scanned: 0,
  total: 0,
  done: false,
}

/** Files past this size are listed but not read: they are not notes. */
const MAX_BYTES = 1024 * 1024
/** How many files are read at once. */
const BATCH = 8
/** Folders that belong to tools, not to the notes. */
const SKIPPED = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.markdown-viewer'])

function isHtml(name: string): boolean {
  return /\.html?$/i.test(name)
}

/** Only Markdown carries links, aliases and properties; a .txt is plain text. */
function isNote(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

async function collect(
  source: IndexSource,
  baseId: string,
  path: string,
  into: Entry[],
): Promise<void> {
  let entries: Entry[] = []
  try {
    entries = await source.list(baseId, path)
  } catch {
    return // a folder that cannot be read is simply not indexed
  }

  for (const entry of entries) {
    // Hidden files and folders (`.claude`, `.obsidian`) can be looked at in the
    // tree, but they are not notes: no search, no links, no quick open.
    if (entry.name.startsWith('.')) continue
    if (entry.kind === 'directory') {
      if (!SKIPPED.has(entry.name)) await collect(source, baseId, entry.path, into)
    } else into.push(entry)
  }
}

const resolvers = new WeakMap<BaseIndex, Resolver>()

/** The link resolver for an index, built once per finished index. */
export function resolverOf(index: BaseIndex): Resolver {
  let resolver = resolvers.get(index)
  if (!resolver) {
    const aliases: [string, string][] = []
    for (const file of Object.values(index.files)) {
      for (const alias of file.aliases) aliases.push([alias, file.path])
    }
    resolver = createResolver(index.paths, aliases)
    resolvers.set(index, resolver)
  }
  return resolver
}

export interface IndexProgress {
  (index: BaseIndex): void
}

export async function buildIndex(
  source: IndexSource,
  baseId: string,
  onProgress: IndexProgress,
  shouldStop: () => boolean,
): Promise<BaseIndex> {
  const all: Entry[] = []
  await collect(source, baseId, '', all)
  // HTML pages enter too: they are first-class here, with a title and backlinks.
  const entries = all.filter((entry) => isTextFile(entry.name) || isHtml(entry.name))

  const index: BaseIndex = {
    ...EMPTY_INDEX,
    files: {},
    backlinks: {},
    paths: all.map((entry) => entry.path),
    total: entries.length,
  }
  onProgress({ ...index })

  const raw = new Map<string, { target: string; embed: boolean }[]>()

  for (let start = 0; start < entries.length; start += BATCH) {
    if (shouldStop()) return index

    await Promise.all(
      entries.slice(start, start + BATCH).map(async (entry) => {
        try {
          const stamp = await source.stat(baseId, entry.path)
          if (stamp && stamp.size > MAX_BYTES) return
          const { text } = await source.read(baseId, entry.path)
          const note = isNote(entry.name) ? readNote(text) : null
          raw.set(
            entry.path,
            note
              ? note.links
                  .filter((link) => link.target)
                  .map((link) => ({
                    target: link.target,
                    embed: link.kind === 'embed' || link.kind === 'markdown-image',
                  }))
              : [],
          )
          index.files[entry.id] = {
            baseId,
            path: entry.path,
            name: entry.name,
            title: isHtml(entry.name)
              ? (htmlTitle(text) ?? entry.name)
              : (note?.headings[0]?.text ?? entry.name),
            links: [],
            embeds: [],
            aliases: note?.aliases ?? [],
            tags: note?.tags ?? [],
            properties: note?.properties ?? {},
            headings: note?.headings ?? [],
            blockIds: note?.blockIds ?? [],
          }
        } catch {
          // A file that cannot be read this time is left out of the index.
        }
      }),
    )

    index.scanned = Math.min(start + BATCH, entries.length)
    onProgress({ ...index, files: { ...index.files } })
    // Let the interface breathe between batches.
    await new Promise((resolve_) => setTimeout(resolve_, 0))
  }

  // Resolution needs every path and alias to be known, so it happens at the end.
  const resolver = resolverOf(index)
  for (const [path, targets] of raw) {
    const id = entryId(baseId, path)
    const file = index.files[id]
    if (!file) continue

    const seen = new Set<string>()
    for (const { target, embed } of targets) {
      const resolved = resolver.resolve(target, path)
      if (resolved && embed) file.embeds.push(resolved)
      if (!resolved || resolved === path || seen.has(resolved)) continue
      seen.add(resolved)
      file.links.push(resolved)
      const key = entryId(baseId, resolved)
      index.backlinks[key] = [...(index.backlinks[key] ?? []), id]
    }
  }

  index.done = true
  const finished = { ...index }
  resolvers.set(finished, resolver)
  onProgress(finished)
  return finished
}

/** Every tag in the base, with how many files carry it, most used first. */
export function tagCounts(index: BaseIndex): [tag: string, count: number][] {
  const counts = new Map<string, number>()
  for (const file of Object.values(index.files)) {
    for (const tag of new Set(file.tags.map((t) => t.toLowerCase()))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
