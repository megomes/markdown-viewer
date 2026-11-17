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

import { entryId, isTextFile, type Entry, type FileSystem, type FileVersion } from './fs'
import { htmlTitle } from './html'
import { readNote, type Heading } from './note'
import { createResolver, type Resolver } from './resolver'

/** The part of the filesystem port the index reads through. */
export type IndexSource = Pick<FileSystem, 'list' | 'stat' | 'read' | 'scan'>

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

const scoped = new WeakMap<BaseIndex, Map<string, BaseIndex>>()

/**
 * The part of an index that is under one folder: what search and quick open
 * look at inside an environment. Links are never resolved against it, they see
 * the whole base. The same index and folder give the same object back, so what
 * is computed from it is not computed again.
 */
export function indexUnder(index: BaseIndex, folder: string): BaseIndex {
  if (!folder) return index
  let known = scoped.get(index)
  if (!known) scoped.set(index, (known = new Map()))
  const ready = known.get(folder)
  if (ready) return ready
  const prefix = folder + '/'
  const files: BaseIndex['files'] = {}
  for (const [id, file] of Object.entries(index.files)) {
    if (file.path.startsWith(prefix)) files[id] = file
  }
  const part: BaseIndex = {
    ...index,
    files,
    paths: index.paths.filter((path) => path.startsWith(prefix)),
  }
  known.set(folder, part)
  return part
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

/** How a build went, for the logs: where the time of a big vault goes. */
export interface IndexStats {
  /** Every file in the base, notes or not. */
  files: number
  /** Text files read from the disk this time. */
  read: number
  /** Text files whose last reading was still good (same size and date). */
  reused: number
  /** Left out: past the size limit, or not readable. */
  skipped: number
  listMs: number
  readMs: number
  resolveMs: number
  totalMs: number
}

/** How many files are read at once. */
const BATCH = 16
/** Work done between two pauses for the interface, in milliseconds. */
const SLICE_MS = 12
/** How often a partial index is handed out while reading. */
const PROGRESS_MS = 300

/** What one file gave, kept to be reused while its size and date stay the same. */
interface Reading {
  stamp: string
  file: Omit<IndexedFile, 'links' | 'embeds'>
  raw: { target: string; embed: boolean }[]
}

/**
 * The last reading of each file, per base. An index is built again on every
 * rename, move and change seen on the disk; reading and parsing only what
 * changed is what keeps that cheap in a vault of thousands of notes.
 */
const readings = new Map<string, Map<string, Reading>>()

/**
 * The size and date the index last read a file at, or null. The search keeps
 * the text of a file for as long as this stays the same.
 */
export function readingStamp(baseId: string, path: string): string | null {
  return readings.get(baseId)?.get(path)?.stamp || null
}

/** Forgets what was read of a base, so the next build reads everything again. */
export function forgetReadings(baseId: string): void {
  readings.delete(baseId)
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Gives the interface its turn. `setTimeout(0)` is not used: a browser waits at
 * least 4 ms on it and much longer in a window that is in the background, and
 * between every batch of a big vault that added up to seconds.
 */
export function yieldToHost(): Promise<void> {
  const immediate = (globalThis as { setImmediate?: (run: () => void) => unknown }).setImmediate
  if (typeof immediate === 'function') return new Promise((done) => void immediate(() => done()))
  if (typeof MessageChannel === 'function') {
    return new Promise((done) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => done()
      channel.port2.postMessage(null)
    })
  }
  return new Promise((done) => setTimeout(done, 0))
}

function readingOf(baseId: string, entry: Entry, text: string, stamp: string): Reading {
  const note = isNote(entry.name) ? readNote(text) : null
  return {
    stamp,
    raw: note
      ? note.links
          .filter((link) => link.target)
          .map((link) => ({
            target: link.target,
            embed: link.kind === 'embed' || link.kind === 'markdown-image',
          }))
      : [],
    file: {
      baseId,
      path: entry.path,
      name: entry.name,
      title: isHtml(entry.name)
        ? (htmlTitle(text) ?? entry.name)
        : (note?.headings[0]?.text ?? entry.name),
      aliases: note?.aliases ?? [],
      tags: note?.tags ?? [],
      properties: note?.properties ?? {},
      headings: note?.headings ?? [],
      blockIds: note?.blockIds ?? [],
    },
  }
}

export async function buildIndex(
  source: IndexSource,
  baseId: string,
  onProgress: IndexProgress,
  shouldStop: () => boolean,
  onStats?: (stats: IndexStats) => void,
): Promise<BaseIndex> {
  const started = now()
  const all: Entry[] = []
  // The size and date of each file, when the platform scanned them all at once.
  const versions = new Map<string, FileVersion>()
  const scanned = source.scan ? await source.scan(baseId).catch(() => null) : null
  if (scanned) {
    for (const file of scanned) {
      const parts = file.path.split('/')
      if (parts.some((part) => part.startsWith('.') || SKIPPED.has(part))) continue
      const name = parts[parts.length - 1]!
      all.push({ id: entryId(baseId, file.path), baseId, path: file.path, name, kind: 'file' })
      versions.set(file.path, { size: file.size, modifiedAt: file.modifiedAt })
    }
  } else await collect(source, baseId, '', all)
  // HTML pages enter too: they are first-class here, with a title and backlinks.
  const entries = all.filter((entry) => isTextFile(entry.name) || isHtml(entry.name))
  const listMs = now() - started

  const index: BaseIndex = {
    ...EMPTY_INDEX,
    files: {},
    backlinks: {},
    paths: all.map((entry) => entry.path),
    total: entries.length,
  }
  onProgress({ ...index })

  const before = readings.get(baseId) ?? new Map<string, Reading>()
  const after = new Map<string, Reading>()
  const stats = { read: 0, reused: 0, skipped: 0 }
  let slice = now()
  let shown = now()

  for (let start = 0; start < entries.length; start += BATCH) {
    if (shouldStop()) return index

    await Promise.all(
      entries.slice(start, start + BATCH).map(async (entry) => {
        try {
          const version = versions.get(entry.path) ?? (await source.stat(baseId, entry.path))
          if (version && version.size > MAX_BYTES) {
            stats.skipped++
            return
          }
          const stamp = version ? `${version.size}:${version.modifiedAt}` : ''
          let reading = stamp ? before.get(entry.path) : undefined
          if (reading && reading.stamp === stamp) stats.reused++
          else {
            const { text } = await source.read(baseId, entry.path)
            reading = readingOf(baseId, entry, text, stamp)
            stats.read++
          }
          after.set(entry.path, reading)
          index.files[entry.id] = { ...reading.file, links: [], embeds: [] }
        } catch {
          // A file that cannot be read this time is left out of the index.
          stats.skipped++
        }
      }),
    )

    index.scanned = Math.min(start + BATCH, entries.length)
    if (now() - shown > PROGRESS_MS) {
      shown = now()
      onProgress({ ...index, files: { ...index.files } })
    }
    if (now() - slice > SLICE_MS) {
      await yieldToHost()
      slice = now()
    }
  }
  readings.set(baseId, after)
  const readMs = now() - started - listMs

  // Resolution needs every path and alias to be known, so it happens at the end.
  const resolveStart = now()
  const resolver = resolverOf(index)
  let count = 0
  for (const [path, reading] of after) {
    if (++count % 200 === 0 && now() - slice > SLICE_MS) {
      await yieldToHost()
      slice = now()
    }
    const id = entryId(baseId, path)
    const file = index.files[id]
    if (!file) continue

    const seen = new Set<string>()
    for (const { target, embed } of reading.raw) {
      const resolved = resolver.resolve(target, path)
      if (resolved && embed) file.embeds.push(resolved)
      if (!resolved || resolved === path || seen.has(resolved)) continue
      seen.add(resolved)
      file.links.push(resolved)
      const key = entryId(baseId, resolved)
      const list = index.backlinks[key]
      if (list) list.push(id)
      else index.backlinks[key] = [id]
    }
  }

  index.done = true
  const finished = { ...index }
  resolvers.set(finished, resolver)
  onProgress(finished)
  const totalMs = now() - started
  onStats?.({
    files: all.length,
    ...stats,
    listMs: Math.round(listMs),
    readMs: Math.round(readMs),
    resolveMs: Math.round(now() - resolveStart),
    totalMs: Math.round(totalMs),
  })
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
