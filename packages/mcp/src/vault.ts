/**
 * The vault as the MCP server sees it: the same index the app builds, read from
 * disk with Node, kept in memory and rebuilt when something in the folder
 * changes. Every question the tools answer goes through here.
 */

import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, rename as fsRename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import {
  buildIndex,
  resolverOf,
  tagCounts,
  type BaseIndex,
  type IndexedFile,
  type IndexSource,
} from '@markdown-viewer/core/base-index'
import { parseBase, runView, showValue } from '@markdown-viewer/core/bases'
import type { Entry } from '@markdown-viewer/core/fs'
import { htmlText } from '@markdown-viewer/core/html'
import { rewriteLinks } from '@markdown-viewer/core/rewrite'
import { search, type SearchDoc } from '@markdown-viewer/core/search'
import { decode, encode } from '@markdown-viewer/core/text'

const BASE = 'vault'
const HIDDEN = (name: string) => name.startsWith('.') || name === 'node_modules'

function nodeSource(root: string): IndexSource {
  const full = (path: string) => join(root, ...path.split('/'))
  return {
    async list(_baseId, path) {
      const entries = await readdir(full(path), { withFileTypes: true })
      return entries
        .filter((entry) => !HIDDEN(entry.name))
        .map((entry): Entry => ({
          id: BASE + ':' + (path ? path + '/' : '') + entry.name,
          baseId: BASE,
          path: (path ? path + '/' : '') + entry.name,
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
        }))
    },
    async stat(_baseId, path) {
      try {
        const info = await stat(full(path))
        return { size: info.size, modifiedAt: info.mtimeMs }
      } catch {
        return null
      }
    },
    async read(_baseId, path) {
      const bytes = await readFile(full(path))
      const info = await stat(full(path))
      const { text, shape } = decode(new Uint8Array(bytes))
      return { text, shape, version: { size: info.size, modifiedAt: info.mtimeMs } }
    },
  }
}

export class Vault {
  private index: BaseIndex | null = null
  private building: Promise<BaseIndex> | null = null
  private texts = new Map<string, string>()
  private watcher: FSWatcher | null = null

  constructor(readonly root: string) {}

  /** Starts watching the folder; any change makes the next question rebuild. */
  watch(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, file) => {
        const path = String(file ?? '')
          .split(sep)
          .join('/')
        if (path.startsWith('.obsidian/') || path.startsWith('.git/')) return
        this.invalidate()
      })
    } catch {
      // No recursive watch here: answers rebuild on every call instead.
      this.watcher = null
    }
  }

  close(): void {
    this.watcher?.close()
  }

  invalidate(): void {
    this.index = null
    this.building = null
    this.texts.clear()
  }

  async ready(): Promise<BaseIndex> {
    if (this.index && this.watcher) return this.index
    this.building ??= buildIndex(
      nodeSource(this.root),
      BASE,
      () => {},
      () => false,
    ).then((index) => {
      this.index = index
      return index
    })
    return this.building
  }

  private full(path: string): string {
    const absolute = join(this.root, ...path.split('/'))
    const back = relative(this.root, absolute)
    if (back.startsWith('..') || back.includes(':'))
      throw new Error('Caminho fora do vault: ' + path)
    return absolute
  }

  async text(path: string): Promise<string> {
    const cached = this.texts.get(path)
    if (cached !== undefined) return cached
    const { text } = decode(new Uint8Array(await readFile(this.full(path))))
    this.texts.set(path, text)
    return text
  }

  private file(index: BaseIndex, path: string): IndexedFile | undefined {
    return index.files[BASE + ':' + path]
  }

  /** A vault path, or a link written as in a note (`[[Nome]]`, an alias, a partial path). */
  async locate(pathOrLink: string, from = ''): Promise<string | null> {
    const index = await this.ready()
    const cleaned = pathOrLink
      .replace(/^\[\[|\]\]$/g, '')
      .split('|')[0]!
      .split('#')[0]!
      .trim()
    if (index.paths.includes(cleaned)) return cleaned
    return resolverOf(index).resolve(cleaned, from)
  }

  async search(query: string, limit: number) {
    const index = await this.ready()
    const docs: SearchDoc[] = []
    for (const file of Object.values(index.files)) {
      const text = await this.text(file.path).catch(() => '')
      docs.push({
        path: file.path,
        title: file.title,
        text: /\.html?$/i.test(file.path) ? htmlText(text) : text,
        tags: file.tags,
        aliases: file.aliases,
      })
    }
    return search(query, docs, limit)
  }

  async note(path: string) {
    const index = await this.ready()
    const file = this.file(index, path)
    const backlinks = (index.backlinks[BASE + ':' + path] ?? []).map((id) =>
      id.slice(BASE.length + 1),
    )
    return { file, backlinks }
  }

  async backlinks(path: string): Promise<{ path: string; title: string }[]> {
    const index = await this.ready()
    return (index.backlinks[BASE + ':' + path] ?? []).map((id) => {
      const file = index.files[id]
      return { path: id.slice(BASE.length + 1), title: file?.title ?? id }
    })
  }

  async tags() {
    return tagCounts(await this.ready())
  }

  async properties(name?: string) {
    const index = await this.ready()
    const counts = new Map<string, number>()
    const values = new Map<string, number>()
    for (const file of Object.values(index.files)) {
      for (const [key, value] of Object.entries(file.properties)) {
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if (name && key === name) {
          for (const one of Array.isArray(value) ? value : [value]) {
            const shown = showValue(one)
            values.set(shown, (values.get(shown) ?? 0) + 1)
          }
        }
      }
    }
    const sort = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1])
    return name
      ? { property: name, files: counts.get(name) ?? 0, values: sort(values) }
      : sort(counts)
  }

  async queryBase(path: string, viewName?: string) {
    const index = await this.ready()
    const config = parseBase(await this.text(path))
    const viewIndex = viewName
      ? Math.max(
          0,
          config.views.findIndex((v) => v.name.toLowerCase() === viewName.toLowerCase()),
        )
      : 0
    const files = Object.values(index.files)
      .filter((file) => /\.(md|markdown)$/i.test(file.path))
      .map((file) => ({
        path: file.path,
        tags: file.tags,
        links: file.links,
        embeds: file.embeds,
        properties: file.properties,
      }))
    const result = runView(config, viewIndex, files)
    return {
      views: config.views.map((v) => v.name),
      view: result.view.name,
      total: result.total,
      errors: result.errors,
      columns: result.columns,
      groups: result.groups.map((group) => ({
        group: result.view.groupBy ? showValue(group.key) : undefined,
        rows: group.rows.map((row) => ({
          path: row.path,
          ...Object.fromEntries(result.columns.map((c) => [c.label, showValue(row.values[c.key])])),
        })),
      })),
    }
  }

  /**
   * Moves a file or folder and points every link at its new place, the way the
   * app does it. Refuses to overwrite.
   */
  async rename(from: string, to: string): Promise<{ moved: number; updated: string[] }> {
    const index = await this.ready()
    const source = this.full(from)
    const target = this.full(to)
    try {
      await stat(target)
      throw new Error('Já existe um arquivo em ' + to)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const moved = new Map<string, string>()
    for (const path of index.paths) {
      if (path === from) moved.set(path, to)
      else if (path.startsWith(from + '/')) moved.set(path, to + path.slice(from.length))
    }
    if (!moved.size) throw new Error('Nada encontrado em ' + from)

    const resolver = resolverOf(index)
    const names = new Map<string, number>()
    for (const path of index.paths.map((p) => moved.get(p) ?? p)) {
      const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
      names.set(name, (names.get(name) ?? 0) + 1)
    }
    const ctx = {
      moved,
      resolveBefore: (target_: string, fromPath: string) => resolver.resolve(target_, fromPath),
      nameIsAmbiguous: (name: string) => (names.get(name.toLowerCase()) ?? 0) > 1,
    }

    await mkdir(dirname(target), { recursive: true })
    await fsRename(source, target)

    const updated: string[] = []
    for (const file of Object.values(index.files)) {
      if (!/\.(md|markdown)$/i.test(file.path)) continue
      if (!file.links.some((link) => moved.has(link)) && !moved.has(file.path)) continue
      const now = moved.get(file.path) ?? file.path
      const bytes = await readFile(this.full(now))
      const { text, shape } = decode(new Uint8Array(bytes))
      const next = rewriteLinks(text, file.path, now, ctx)
      if (next === null) continue
      await writeFile(this.full(now), encode(next, shape))
      updated.push(now)
    }
    this.invalidate()
    return { moved: moved.size, updated }
  }
}
