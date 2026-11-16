/**
 * The vault on the phone, as the screens see it: paired or not, what is in it,
 * whether it is syncing. One instance for the whole app.
 *
 * It keeps the mirror up to date in three ways: when the app opens, when the
 * server says something changed (WebSocket), and when the app comes back to the
 * front. The index is the desktop's (`@markdown-viewer/core`), built from the
 * notes on the device, so links and aliases resolve the same way.
 *
 * What is written here (notes edited, created, renamed, moved, deleted) is
 * saved on the device first and sent a moment later. Without a network it
 * waits: the mirror keeps it until the server accepts it.
 */

import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import {
  buildIndex,
  EMPTY_INDEX,
  resolverOf,
  type BaseIndex,
} from '@markdown-viewer/core/base-index'
import { decode, encode, type TextShape } from '@markdown-viewer/core/text'
import { rewriteLinks } from '@markdown-viewer/core/rewrite'
import type { Entry } from '@markdown-viewer/core/fs'
import { httpRemote, listen } from '@markdown-viewer/sync/http-remote'
import { VaultMirror, type MirrorFile, type MirrorProgress } from '@markdown-viewer/sync/mirror'
import { forgetPairing, loadPaired, pair, type Paired, type PairingCode } from './pairing'
import {
  loadEmptyFolders,
  PhoneFiles,
  PhoneMirrorStore,
  saveEmptyFolders,
  wipeLocalVault,
} from './storage'

/** The single base on the phone. Ids and links are made against it. */
export const VAULT_BASE = 'vault'
/** Where photos and pasted images go, as in the vault's Obsidian settings (spec, section 2). */
export const ATTACHMENTS = 'Files'

export interface VaultSnapshot {
  phase: 'loading' | 'unpaired' | 'ready'
  deviceName: string | null
  files: MirrorFile[]
  /** Folders made here with nothing in them yet. */
  folders: string[]
  index: BaseIndex
  syncing: boolean
  progress: MirrorProgress | null
  lastSync: number | null
  /** Files changed here that the server has not accepted yet. */
  pending: number
  /** The last thing worth telling: a conflict copy that was kept. */
  notice: string | null
  error: string | null
}

let snapshot: VaultSnapshot = {
  phase: 'loading',
  deviceName: null,
  files: [],
  folders: [],
  index: EMPTY_INDEX,
  syncing: false,
  progress: null,
  lastSync: null,
  pending: 0,
  notice: null,
  error: null,
}
const listeners = new Set<() => void>()

function set(patch: Partial<VaultSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function useVault(): VaultSnapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
  )
}

const files = new PhoneFiles()
let mirror: VaultMirror | null = null
let stopListening: (() => void) | null = null
let started = false

function vault(): VaultMirror {
  if (!mirror) throw new Error('O vault não está pareado.')
  return mirror
}

async function open(paired: Paired): Promise<void> {
  const crypto = await VaultCrypto.create(paired.key)
  mirror = new VaultMirror({
    files,
    store: new PhoneMirrorStore(),
    remote: httpRemote(paired.connection),
    crypto,
    deviceName: paired.deviceName,
    onProgress: (progress) => set({ progress }),
  })
  set({
    phase: 'ready',
    deviceName: paired.deviceName,
    files: await mirror.catalog(),
    folders: await loadEmptyFolders(),
    pending: await mirror.pendingCount(),
  })
  void reindex()
  stopListening = listen(paired.connection, () => void syncNow())
  void syncNow()
}

/** Called once, from the root layout. */
export async function startVault(): Promise<void> {
  if (started) return
  started = true
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncNow()
  })
  try {
    const paired = await loadPaired()
    if (paired) await open(paired)
    else set({ phase: 'unpaired' })
  } catch (error) {
    set({ phase: 'unpaired', error: messageOf(error) })
  }
}

export async function pairWith(code: PairingCode, deviceName: string): Promise<void> {
  const paired = await pair(code, deviceName)
  set({ error: null })
  await open(paired)
}

export async function unpair(): Promise<void> {
  stopListening?.()
  stopListening = null
  mirror = null
  await forgetPairing()
  wipeLocalVault()
  set({
    phase: 'unpaired',
    files: [],
    folders: [],
    index: EMPTY_INDEX,
    lastSync: null,
    deviceName: null,
    pending: 0,
    notice: null,
  })
}

let syncAgain = false

export async function syncNow(): Promise<void> {
  const current = mirror
  if (!current) return
  if (snapshot.syncing) {
    // Something was saved while a pass ran: one more goes right after it.
    syncAgain = true
    return
  }
  set({ syncing: true, error: null })
  try {
    const report = await current.sync()
    set({
      files: await current.catalog(),
      pending: await current.pendingCount(),
      lastSync: Date.now(),
      ...(report.conflicts.length
        ? { notice: 'Conflito: sua versão ficou em "' + report.conflicts.join('", "') + '".' }
        : {}),
    })
    if (report.changed > 0 || report.conflicts.length > 0) void reindex()
  } catch (error) {
    // Offline is normal on a phone: what is on the device still opens and still saves.
    set({ error: messageOf(error), pending: await current.pendingCount() })
  } finally {
    set({ syncing: false, progress: null })
    if (syncAgain) {
      syncAgain = false
      void syncNow()
    }
  }
}

export function dismissNotice(): void {
  set({ notice: null })
}

let syncTimer: ReturnType<typeof setTimeout> | null = null
let indexTimer: ReturnType<typeof setTimeout> | null = null

/** After something was written here: the screens see it now, the server a moment later. */
async function changed(): Promise<void> {
  const current = vault()
  set({ files: await current.catalog(), pending: await current.pendingCount() })
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(() => void reindex(), 1200)
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => void syncNow(), 2000)
}

/** The bytes of a file, downloaded first when it waits to be opened (PDFs). */
export async function readFile(path: string): Promise<Uint8Array> {
  const bytes = await vault().open(path)
  // A file fetched on demand is now on the device: the list says so.
  if (snapshot.files.find((file) => file.path === path)?.local === false) {
    set({ files: await vault().catalog() })
  }
  return bytes
}

/**
 * A file is known by its id, never by its path: the id is the one the server
 * gave it and stays the same when it is renamed or moved. A screen that shows a
 * file holds the id, so a rename is only a new title for it.
 */
export function fileOf(id: string): MirrorFile | null {
  return snapshot.files.find((file) => file.fileId === id) ?? null
}

export function idAt(path: string): string | null {
  return snapshot.files.find((file) => file.path === path)?.fileId ?? null
}

/** How each note was written (line endings, BOM), so saving keeps it. By file id. */
const shapes = new Map<string, TextShape>()
const DEFAULT_SHAPE = decode(new Uint8Array()).shape
/**
 * The version of each file that the editor on this phone wrote last. A screen
 * that sees the file change to this version knows it is its own text coming
 * back, and does not load it over what was typed since.
 */
const written = new Map<string, string>()

export function isOwnWrite(id: string, hash: string): boolean {
  return written.get(id) === hash
}

export async function readText(path: string): Promise<string> {
  const { text, shape } = decode(await readFile(path))
  const id = idAt(path)
  if (id) shapes.set(id, shape)
  return text
}

/* ------------------------------------------------------------ writing */

/** Saves the text of a note, wherever it lives now. */
export async function saveText(id: string, text: string): Promise<void> {
  const file = fileOf(id)
  if (!file) throw new Error('Esta nota não existe mais no vault.')
  const saved = await vault().write(file.path, encode(text, shapes.get(id) ?? DEFAULT_SHAPE))
  written.set(id, saved.hash)
  await changed()
}

function exists(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    snapshot.files.some(
      (file) =>
        file.path.toLowerCase() === lower || file.path.toLowerCase().startsWith(lower + '/'),
    ) || snapshot.folders.some((folder) => folder.toLowerCase() === lower)
  )
}

const join = (folder: string, name: string) => (folder ? folder + '/' + name : name)
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** `Sem título.md`, then `Sem título 2.md`: a name nothing in the folder uses. */
function freeName(folder: string, stem: string, extension: string): string {
  for (let i = 1; ; i++) {
    const name = (i === 1 ? stem : `${stem} ${i}`) + extension
    if (!exists(join(folder, name))) return name
  }
}

/** Names a file can have on every device: Windows is the strictest. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'O nome não pode ficar vazio.'
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'O nome não pode ter \\ / : * ? " < > |'
  if (/^\.+$/.test(trimmed) || /[. ]$/.test(name)) return 'O nome não pode terminar em ponto.'
  return null
}

/** A new, empty note in `folder`; resolves to its id. */
export async function createNote(folder: string): Promise<string> {
  const path = join(folder, freeName(folder, 'Sem título', '.md'))
  const file = await vault().write(path, new Uint8Array())
  await forgetEmptyFolder(folder)
  await changed()
  return file.fileId
}

export async function createFolder(parent: string, name: string): Promise<string> {
  const problem = nameProblem(name)
  if (problem) throw new Error(problem)
  const path = join(parent, name.trim())
  if (exists(path)) throw new Error('Já existe algo com esse nome aqui.')
  const folders = [...snapshot.folders, path]
  await saveEmptyFolders(folders)
  set({ folders })
  return path
}

async function forgetEmptyFolder(folder: string): Promise<void> {
  if (!snapshot.folders.includes(folder)) return
  const folders = snapshot.folders.filter((item) => item !== folder)
  await saveEmptyFolders(folders)
  set({ folders })
}

/** Saves a photo or picture in the attachments folder; resolves to its file name. */
export async function attachImage(bytes: Uint8Array, extension: string): Promise<string> {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  const name = freeName(ATTACHMENTS, 'Foto ' + stamp, '.' + extension.toLowerCase())
  await vault().write(join(ATTACHMENTS, name), bytes)
  await changed()
  return name
}

/**
 * Renames or moves a note or a folder (with everything in it), and then points
 * every link at the new place, as the desktop does. Resolves to the new path.
 */
export async function relocate(from: string, to: string): Promise<string> {
  if (from === to) return to
  const problem = nameProblem(nameOf(to))
  if (problem) throw new Error(problem)
  if (to === from || to.startsWith(from + '/'))
    throw new Error('Uma pasta não cabe dentro dela mesma.')
  const onlyCase = from.toLowerCase() === to.toLowerCase()
  if (!onlyCase && exists(to)) throw new Error('Já existe algo com esse nome aqui.')

  const current = vault()
  const moved = new Map<string, string>()
  for (const file of snapshot.files) {
    if (file.path === from) moved.set(file.path, to)
    else if (file.path.startsWith(from + '/'))
      moved.set(file.path, to + file.path.slice(from.length))
  }
  const index = snapshot.index
  for (const [old, next] of moved) await current.move(old, next)
  const folders = snapshot.folders.map((folder) =>
    folder === from ? to : folder.startsWith(from + '/') ? to + folder.slice(from.length) : folder,
  )
  await saveEmptyFolders(folders)
  set({ folders, files: await current.catalog() })
  await forgetEmptyFolder(parentOf(to))
  await updateLinks(index, moved)
  await changed()
  return to
}

/** Every note that pointed at what moved now points at its new place. */
async function updateLinks(index: BaseIndex, moved: Map<string, string>): Promise<void> {
  if (!index.done || moved.size === 0) return
  const resolver = resolverOf(index)
  const names = new Map<string, number>()
  for (const path of index.paths) {
    const name = nameOf(moved.get(path) ?? path).toLowerCase()
    names.set(name, (names.get(name) ?? 0) + 1)
  }
  const ctx = {
    moved,
    resolveBefore: (target: string, fromPath: string) => resolver.resolve(target, fromPath),
    nameIsAmbiguous: (name: string) => (names.get(name.toLowerCase()) ?? 0) > 1,
  }
  for (const file of Object.values(index.files)) {
    const touches = file.links.some((link) => moved.has(link)) || moved.has(file.path)
    if (!touches || !/\.(md|markdown)$/i.test(file.path)) continue
    const now = moved.get(file.path) ?? file.path
    try {
      const { text, shape } = decode(await files.read(now))
      const rewritten = rewriteLinks(text, file.path, now, ctx)
      if (rewritten !== null) await vault().write(now, encode(rewritten, shape))
    } catch {
      // A note that is not on the device keeps its links; the desktop fixes it on its next rename.
    }
  }
}

/** Deletes a note, or a folder with everything in it. */
export async function removePath(path: string): Promise<void> {
  const current = vault()
  for (const file of snapshot.files) {
    if (file.path === path || file.path.startsWith(path + '/')) await current.remove(file.path)
  }
  const folders = snapshot.folders.filter(
    (folder) => folder !== path && !folder.startsWith(path + '/'),
  )
  await saveEmptyFolders(folders)
  set({ folders })
  await changed()
}

/** Every folder of the vault, for choosing where to move something. */
export function allFolders(catalog: MirrorFile[], empty: string[]): string[] {
  const out = new Set<string>(empty)
  for (const file of catalog) {
    let folder = parentOf(file.path)
    while (folder && !out.has(folder)) {
      out.add(folder)
      folder = parentOf(folder)
    }
  }
  for (const folder of empty) {
    let up = parentOf(folder)
    while (up && !out.has(up)) {
      out.add(up)
      up = parentOf(up)
    }
  }
  return [...out]
    .filter((folder) => !folder.split('/').some((part) => part.startsWith('.')))
    .toSorted((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }))
}

/* ------------------------------------------------------------- index */

let indexing: Promise<void> | null = null
let indexAgain = false

/** Builds the index from what is on the device, one pass at a time. */
function reindex(): Promise<void> {
  if (indexing) {
    indexAgain = true
    return indexing
  }
  indexing = (async () => {
    do {
      indexAgain = false
      const index = await buildIndex(
        indexSource(snapshot.files),
        VAULT_BASE,
        () => {},
        () => false,
      )
      set({ index })
    } while (indexAgain)
  })().finally(() => {
    indexing = null
  })
  return indexing
}

/** The catalog as a folder tree, for the index: it lists everything and reads only what is here. */
function indexSource(catalog: MirrorFile[]) {
  const byPath = new Map(catalog.map((file) => [file.path, file]))
  return {
    async list(baseId: string, path: string): Promise<Entry[]> {
      return childrenOf(catalog, path).map((child) => ({
        id: baseId + ':' + child.path,
        baseId,
        path: child.path,
        name: child.name,
        kind: child.kind,
      }))
    },
    async stat(_baseId: string, path: string) {
      const file = byPath.get(path)
      return file ? { size: file.size, modifiedAt: file.mtime } : null
    },
    async read(_baseId: string, path: string) {
      const file = byPath.get(path)
      if (!file?.local) throw new Error('não baixado: ' + path)
      const { text, shape } = decode(await files.read(path))
      return { text, shape, version: { size: file.size, modifiedAt: file.mtime } }
    },
  }
}

export interface TreeNode {
  /** For files: the id that stays when the file is renamed. */
  fileId?: string
  path: string
  name: string
  kind: 'file' | 'directory'
  /** For files: whether they are on the device already. */
  local: boolean
  size: number
  /** Changed here and not on the server yet. */
  pending: boolean
}

/**
 * The folders and files directly inside `folder`, folders first, as in the
 * tree on the desktop. Folders exist only through the files in them (the server
 * knows files, not folders), plus the empty ones made on this phone.
 */
export function childrenOf(
  catalog: MirrorFile[],
  folder: string,
  empty: string[] = [],
): TreeNode[] {
  const prefix = folder ? folder + '/' : ''
  const dirs = new Map<string, TreeNode>()
  const out: TreeNode[] = []
  const addDir = (name: string) => {
    if (!dirs.has(name)) {
      dirs.set(name, {
        path: prefix + name,
        name,
        kind: 'directory',
        local: true,
        size: 0,
        pending: false,
      })
    }
  }
  for (const file of catalog) {
    if (!file.path.startsWith(prefix)) continue
    const rest = file.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      out.push({
        fileId: file.fileId,
        path: file.path,
        name: rest,
        kind: 'file',
        local: file.local,
        size: file.size,
        pending: !!file.pending,
      })
      continue
    }
    addDir(rest.slice(0, slash))
  }
  for (const path of empty) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (rest) addDir(rest.split('/')[0]!)
  }
  const byName = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' })
  return [...[...dirs.values()].toSorted(byName), ...out.toSorted(byName)]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
