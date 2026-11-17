/**
 * The filesystem port.
 *
 * Everything above this file talks only to these types. Each platform supplies
 * one adapter: the browser one uses the File System Access API, and the desktop
 * one will use Tauri. Paths are always '/' separated and relative to the root of
 * the base folder they belong to, with '' meaning the root itself.
 */

import type { TextShape } from './text'

export type EntryKind = 'file' | 'directory'

export interface Entry {
  /** '<baseId>:<path>', unique across every open base. */
  id: string
  baseId: string
  /** Path relative to the base root. '' is the root. */
  path: string
  name: string
  kind: EntryKind
}

export interface Base {
  id: string
  name: string
  /** Absolute path when the platform can tell us one, else just the name. */
  label: string
}

export interface LoadedFile {
  text: string
  shape: TextShape
  /** Stamp used to notice that the file changed behind our back. */
  version: FileVersion
}

export interface ScannedFile {
  /** Relative to the base root, `/`-separated. */
  path: string
  size: number
  modifiedAt: number
}

export interface FileVersion {
  size: number
  modifiedAt: number
}

/**
 * A file opened from outside every base. It is addressed like anything else,
 * through a base id of its own and an empty path, so reading and writing it
 * needs no separate code path.
 */
export interface LooseFile {
  baseId: string
  name: string
  /** Full path when the platform can tell us one, else just the name. */
  label: string
}

/**
 * The outcome of trying to reopen something from a previous session.
 *
 * `needs-permission` exists because of the browser: a folder handle survives a
 * reload, but the permission to read it does not, and asking for it again is
 * only allowed from inside a click. The desktop never returns it.
 */
export type Restored<T> =
  { status: 'ok'; value: T } | { status: 'needs-permission' } | { status: 'gone' }

export interface FileSystem {
  /** Asks the person for a folder and adds it as a base. */
  openBase(): Promise<Base | null>
  /** Asks the person for a single file, which does not enter the tree. */
  openFile(): Promise<LooseFile | null>
  /**
   * Reopens a base by the id it had last time. `interactive` must only be true
   * when this is running inside a click, because that is the only moment a
   * browser lets us ask for permission again.
   */
  restoreBase(baseId: string, interactive: boolean): Promise<Restored<Base>>
  restoreFile(baseId: string, interactive: boolean): Promise<Restored<LooseFile>>
  /** Direct children of `path` inside `base`, already sorted. */
  list(baseId: string, path: string): Promise<Entry[]>
  /**
   * Every file in the base with its size and date, in one go, where the
   * platform can do that natively. The link index uses it instead of a walk
   * that costs a call per folder and per file.
   */
  scan?(baseId: string): Promise<ScannedFile[]>
  read(baseId: string, path: string): Promise<LoadedFile>
  /** The raw bytes, for the files that are not text: images and the like. */
  readBinary(baseId: string, path: string): Promise<Uint8Array>
  /**
   * Writes a throwaway file and hands it to the system. It exists because the
   * desktop web view cannot print: the document goes out to the browser.
   */
  openTemporary(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>
  /** Asks where to put a new file and writes it. Null when nobody chose. */
  saveAs(suggestedName: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | null>

  /** Creates an empty file and hands back its entry. */
  createFile(baseId: string, path: string): Promise<Entry>
  createFolder(baseId: string, path: string): Promise<Entry>
  /** Renames, and moves, within one base. */
  move(baseId: string, from: string, to: string): Promise<Entry>
  /**
   * Renames a loose file where it sits, and hands back its new base id.
   *
   * A loose file is its own base, so this is not a `move`: the base itself
   * changes. Absent where the platform cannot rename a file it was only given
   * a handle to.
   */
  renameLoose?(baseId: string, name: string): Promise<string>
  /** Copies a file beside itself under a free name. */
  duplicate(baseId: string, path: string): Promise<Entry>
  /**
   * Sends the entry to the system trash. Adapters that cannot reach a trash
   * throw instead of deleting for good: losing a file is not a fallback.
   */
  trash(baseId: string, path: string): Promise<void>
  /** Shows the entry in the system's file manager. */
  reveal(baseId: string, path: string): Promise<void>
  /** The absolute path, when the platform is willing to tell us. */
  absolutePath(baseId: string, path: string): string | null
  /** What this platform can actually do, so the menu can hide the rest. */
  readonly can: Capabilities
  write(baseId: string, path: string, bytes: Uint8Array<ArrayBuffer>): Promise<FileVersion>
  /**
   * Calls back whenever anything under the base changes on disk. Returns the
   * function that stops watching. Where the platform has no watcher it returns
   * null, and the app falls back to asking.
   */
  watch(baseId: string, onChange: () => void): Promise<(() => void) | null>
  /** Current stamp, or null when the file is gone. */
  stat(baseId: string, path: string): Promise<FileVersion | null>
}

export interface Capabilities {
  trash: boolean
  reveal: boolean
  absolutePath: boolean
}

export const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt'] as const

export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** True for files the editor opens as plain text, with no Markdown parsing. */
export function isPlainText(name: string): boolean {
  return name.toLowerCase().endsWith('.txt')
}

/**
 * How the app shows a file. `note` is the editor; the rest are viewers. Null is
 * a file the app does not open itself and hands to the system.
 */
export type Viewer = 'note' | 'html' | 'pdf' | 'image' | 'code' | 'base'

const VIEWERS: Record<string, Viewer> = {
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  base: 'base',
}
for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']) {
  VIEWERS[ext] = 'image'
}
for (const ext of [
  'json',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'css',
  'scss',
  'py',
  'lua',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'xml',
  'sh',
  'bash',
  'ps1',
  'bat',
  'cmd',
  'sql',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rs',
  'go',
  'java',
  'kt',
  'swift',
  'rb',
  'php',
  'r',
  'csv',
  'tsv',
  'log',
  'env',
  'gitignore',
  'dockerfile',
  'makefile',
  'tex',
  'vue',
  'svelte',
]) {
  VIEWERS[ext] = 'code'
}

export function viewerOf(name: string): Viewer | null {
  if (isTextFile(name)) return 'note'
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot < 0 ? lower : lower.slice(dot + 1)
  return VIEWERS[ext] ?? null
}

export function entryId(baseId: string, path: string): string {
  return baseId + ':' + path
}

export function joinPath(parent: string, name: string): string {
  return parent === '' ? name : parent + '/' + name
}

/** The folder an entry sits in. '' when it sits at the root of the base. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

export function baseName(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? path : path.slice(cut + 1)
}

/**
 * The last piece of a path that came from the operating system.
 *
 * Deliberately not the same function as `baseName`. Paths inside a base are
 * this app's own, always joined with `/`, and on macOS and Linux a backslash
 * is a perfectly legal character in a file name: splitting those on `\` would
 * cut real names in half. A path handed over by Windows, on the other hand,
 * is separated by backslashes and by nothing else, and a name cut from it with
 * `/` alone comes back as the whole path, which is what the tab was showing.
 */
export function nativeBaseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = cut < 0 ? path : path.slice(cut + 1)
  // A path that ends in its separator, as a dropped folder can, still has a
  // name one step up.
  return name === '' ? nativeBaseName(path.slice(0, -1)) : name
}

/**
 * The name without its extension, for showing rather than for addressing.
 *
 * A leading dot is not an extension: `.gitignore` is the whole name, and
 * cutting at that dot would leave nothing at all.
 */
export function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

/** `nota.md` becomes `nota copia.md`, keeping the extension where it belongs. */
export function copyName(name: string, suffix: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name + ' ' + suffix
  return name.slice(0, dot) + ' ' + suffix + name.slice(dot)
}

/** Folders first, then files, each group by name, the way Finder shows them. */
export function compareEntries(a: Entry, b: Entry): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}
