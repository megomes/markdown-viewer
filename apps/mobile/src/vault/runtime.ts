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
import { log, timed } from '@markdown-viewer/core/log'
import { BOOKMARKS_FILE, bookmarkedFiles, toggleBookmark } from '@markdown-viewer/core/bookmarks'
import type { Entry } from '@markdown-viewer/core/fs'
import {
  ICONIZE_FILE,
  ICONS_FILE,
  iconsAfterMove,
  iconsAfterRemove,
  parseIconize,
  parseIcons,
  serializeIcons,
  type IconMap,
} from '@markdown-viewer/core/icons'
import {
  ATTACHMENTS,
  environmentsOf,
  parseEnvironments,
  type EnvironmentsConfig,
} from '@markdown-viewer/core/environments'
import {
  attachmentName,
  attachmentsFolder,
  isAttachmentsFolder,
} from '@markdown-viewer/core/attachments'
import {
  captureBody,
  captureName,
  defaultCaptureFolder,
  noteSnippet,
} from '@markdown-viewer/core/capture'
import { accentOf } from '@markdown-viewer/core/environments'
import { setWidgetNotes, type WidgetNote } from '../../modules/quick-capture'
import { loadPrefs, savePrefs, wipePrefs, type Prefs } from './prefs'
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
export const ENVIRONMENTS_FILE = '.markdown-viewer/environments.json'

export interface VaultSnapshot {
  phase: 'loading' | 'unpaired' | 'ready'
  deviceName: string | null
  files: MirrorFile[]
  /** Folders made here with nothing in them yet. */
  folders: string[]
  index: BaseIndex
  /** The icon of each folder and file that has one, by path. */
  icons: IconMap
  /** The folders at the root that are environments, and the colour of each. */
  environments: string[]
  environmentColors: Record<string, string>
  /** File ids of the notes pinned to the widget. */
  pins: string[]
  /** Paths in Obsidian's favourites (`.obsidian/bookmarks.json`). */
  bookmarks: string[]
  /** The vault's name on the sync server, which the Obsidian link carries. */
  vaultName: string
  /** Where a quick capture goes: the folder chosen, or the one the app picks. */
  captureFolder: string
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
  icons: {},
  environments: [],
  environmentColors: {},
  pins: [],
  bookmarks: [],
  vaultName: '',
  captureFolder: '',
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
let lastProgress = 0

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
    // A few times a second at most: every screen redraws on each one, and a
    // first sync of a big vault reports thousands.
    onProgress: (progress) => {
      const now = Date.now()
      if (now - lastProgress < 250 && progress.done < progress.total) return
      lastProgress = now
      set({ progress })
    },
  })
  set({
    phase: 'ready',
    deviceName: paired.deviceName,
    vaultName: paired.connection.vault,
    files: await mirror.catalog(),
    folders: await loadEmptyFolders(),
    pending: await mirror.pendingCount(),
  })
  prefs = await loadPrefs()
  set({ pins: prefs.pins })
  void reindex()
  void loadVaultSettings().then(refreshCapture)
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
    if (paired) {
      await timed('vault', 'abrir', () => open(paired))
      log.info('vault', 'aberto', {
        arquivos: snapshot.files.length,
        baixados: snapshot.files.filter((file) => file.local).length,
      })
    } else set({ phase: 'unpaired' })
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
  wipePrefs()
  prefs = { pins: [], captureFolder: null }
  setWidgetNotes([])
  set({
    phase: 'unpaired',
    files: [],
    folders: [],
    index: EMPTY_INDEX,
    icons: {},
    environments: [],
    environmentColors: {},
    pins: [],
    captureFolder: '',
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
  const started = Date.now()
  try {
    const report = await current.sync()
    const ms = Date.now() - started
    ;(report.changed || report.conflicts.length || ms > 3000 ? log.info : log.debug)(
      'sync',
      'passada',
      { ms, mudaram: report.changed, conflitos: report.conflicts.length },
    )
    set({
      files: await current.catalog(),
      pending: await current.pendingCount(),
      lastSync: Date.now(),
      ...(report.conflicts.length
        ? { notice: 'Conflito: sua versão ficou em "' + report.conflicts.join('", "') + '".' }
        : {}),
    })
    if (report.changed > 0 || report.conflicts.length > 0) void reindex()
    void loadVaultSettings().then(refreshCapture)
  } catch (error) {
    // Offline is normal on a phone: what is on the device still opens and still saves.
    log.warn('sync', 'passada parou', { ms: Date.now() - started, motivo: messageOf(error) })
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
  void loadVaultSettings().then(refreshCapture)
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
  const { text, shape } = decode(await timed('nota', 'ler', () => readFile(path), { slowMs: 300 }))
  const id = idAt(path)
  if (id) shapes.set(id, shape)
  return text
}

/* ------------------------------------------------------------ writing */

/** Saves the text of a note, wherever it lives now. */
export async function saveText(id: string, text: string): Promise<void> {
  const file = fileOf(id)
  if (!file) throw new Error('Esta nota não existe mais no vault.')
  const saved = await timed(
    'nota',
    'salvar',
    () => vault().write(file.path, encode(text, shapes.get(id) ?? DEFAULT_SHAPE)),
    { slowMs: 300, fields: { kb: Math.round(text.length / 1024) } },
  )
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

/**
 * Saves a photo or picture as an attachment of a note, as the desktop does: in
 * the `Files` folder of the note's environment, under the note's name and a
 * number. Resolves to the file name, which is what the embed is written with.
 */
export async function attachImage(
  noteId: string,
  bytes: Uint8Array,
  extension: string,
): Promise<string> {
  const note = fileOf(noteId)
  if (!note) throw new Error('Esta nota não existe mais no vault.')
  const folder = attachmentsFolder(note.path, snapshot.environments)
  // An embed is found by its name alone: no two files of the vault may share it.
  const taken = new Set(snapshot.files.map((file) => nameOf(file.path).toLowerCase()))
  const name = attachmentName(nameOf(note.path), extension, (candidate) =>
    taken.has(candidate.toLowerCase()),
  )
  await vault().write(join(folder, name), bytes)
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
  // The icon goes with the folder, as on the desktop.
  await writeIcons(iconsAfterMove(snapshot.icons, from, to))
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

/** Obsidian's "Make a copy": the same bytes beside it, as `Nome 2.md`. Resolves to its id. */
export async function duplicatePath(path: string): Promise<string> {
  const name = nameOf(path)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  const folder = parentOf(path)
  let copy = ''
  for (let i = 2; ; i++) {
    copy = join(folder, `${stem} ${i}${extension}`)
    if (!exists(copy)) break
  }
  const file = await vault().write(copy, await readFile(path))
  await changed()
  return file.fileId
}

/**
 * Obsidian's "Merge entire file with…": the note's text goes to the end of
 * `target`, the note leaves the vault, and links to it point at `target`.
 */
export async function mergeInto(from: string, target: string): Promise<void> {
  const index = snapshot.index
  const [source, into] = await Promise.all([readFile(from), readFile(target)])
  const a = decode(into)
  const b = decode(source)
  const joined = a.text.replace(/\s*$/, '') + '\n\n' + b.text.replace(/^\s+/, '')
  const saved = await vault().write(target, encode(joined, a.shape))
  const id = idAt(target)
  if (id) written.set(id, saved.hash)
  await vault().remove(from)
  set({ files: await vault().catalog() })
  await updateLinks(index, new Map([[from, target]]))
  await changed()
}

/** Adds the file to Obsidian's favourites, or takes it out. */
export async function toggleBookmarkPath(path: string): Promise<void> {
  let text: string | null = null
  if (snapshot.files.some((file) => file.path === BOOKMARKS_FILE)) {
    text = decode(await readFile(BOOKMARKS_FILE)).text
  }
  const next = toggleBookmark(text, path)
  await vault().write(BOOKMARKS_FILE, new TextEncoder().encode(next))
  set({ bookmarks: bookmarkedFiles(next).map((file) => file.path) })
  await changed()
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
  await writeIcons(iconsAfterRemove(snapshot.icons, path))
  await changed()
}

/* ------------------------------------------- quick capture and widget */

let prefs: Prefs = { pins: [], captureFolder: null }

/** The folders a note can be captured into: every one that is not hidden or of attachments. */
export function captureFolders(catalog: MirrorFile[], empty: string[]): string[] {
  return allFolders(catalog, empty).filter(
    (folder) => !isAttachmentsFolder(folder) && !folder.includes('/' + ATTACHMENTS + '/'),
  )
}

/** Where a capture goes: the folder chosen while it still exists, else the app's pick. */
function captureFolderNow(): string {
  const folders = captureFolders(snapshot.files, snapshot.folders)
  const chosen = prefs.captureFolder
  if (chosen !== null && (chosen === '' || folders.includes(chosen))) return chosen
  return defaultCaptureFolder(folders, snapshot.environments)
}

export async function setCaptureFolder(folder: string): Promise<void> {
  prefs = { ...prefs, captureFolder: folder }
  await savePrefs(prefs)
  set({ captureFolder: folder })
}

/** Pins a note to the widget, or takes it off. */
export async function togglePin(id: string): Promise<void> {
  const pins = prefs.pins.includes(id)
    ? prefs.pins.filter((one) => one !== id)
    : [...prefs.pins, id]
  prefs = { ...prefs, pins }
  await savePrefs(prefs)
  set({ pins })
  // A pinned note has to be on the device for the widget to say what is in it.
  const file = fileOf(id)
  if (file && !file.local) await readFile(file.path).catch(() => {})
  await publishWidget()
}

/** What each note says on the widget, by file id, kept while the note does not change. */
const snippets = new Map<string, { hash: string; text: string }>()
const WIDGET_NOTES = 12

/**
 * Tells the widget what to show: the pinned notes, or, with nothing pinned, the
 * ones written last, so a widget just placed is not an empty box.
 */
async function publishWidget(): Promise<void> {
  const isNote = (file: MirrorFile) => /\.(md|markdown)$/i.test(file.path)
  const pinned = prefs.pins
    .map((id) => fileOf(id))
    .filter((file): file is MirrorFile => file !== null)
  const shown =
    pinned.length > 0
      ? pinned
      : snapshot.files
          .filter(
            (file) =>
              isNote(file) && file.local && !file.path.split('/').some((p) => p.startsWith('.')),
          )
          .toSorted((a, b) => b.mtime - a.mtime)
          .slice(0, 6)
  const notes: WidgetNote[] = []
  for (const file of shown.slice(0, WIDGET_NOTES)) {
    let known = snippets.get(file.fileId)
    if (known?.hash !== file.hash) {
      let text = ''
      try {
        if (file.local && isNote(file)) text = noteSnippet(decode(await files.read(file.path)).text)
      } catch {
        // Not readable right now: the title alone.
      }
      known = { hash: file.hash, text }
      snippets.set(file.fileId, known)
    }
    const environment = environmentOf(file.path, snapshot.environments)
    const title = nameOf(file.path).replace(/\.(md|markdown)$/i, '')
    // A note that opens with its own name as a heading does not say it twice.
    const lines = known.text.split('\n')
    const same = (line: string) => line.trim().toLowerCase() === title.trim().toLowerCase()
    notes.push({
      id: file.fileId,
      title,
      text: (lines.length > 0 && same(lines[0]!) ? lines.slice(1) : lines).join('\n'),
      color: environment ? accentOf(snapshot.environmentColors[environment]).dark : '',
    })
  }
  setWidgetNotes(notes)
}

/** After the catalog or the settings changed: the capture folder and the widget follow. */
async function refreshCapture(): Promise<void> {
  if (!mirror) return
  // A pinned note that left the vault leaves the widget's list too.
  const pins = prefs.pins.filter((id) => fileOf(id) !== null)
  if (pins.length !== prefs.pins.length && snapshot.lastSync !== null) {
    prefs = { ...prefs, pins }
    await savePrefs(prefs)
  }
  const captureFolder = captureFolderNow()
  if (captureFolder !== snapshot.captureFolder || prefs.pins !== snapshot.pins) {
    set({ captureFolder, pins: prefs.pins })
  }
  await publishWidget()
}

export interface CaptureInput {
  folder: string
  title: string
  /** What the sharing app called it, if anything was shared. */
  subject: string
  text: string
  images: { bytes: Uint8Array; extension: string }[]
}

/** Writes a captured note; resolves to its id. */
export async function capture(input: CaptureInput): Promise<string> {
  const stem = captureName(input.title, input.subject, input.text, new Date())
  const path = join(input.folder, freeName(input.folder, stem, '.md'))
  const body = captureBody(input.subject, input.text)
  const file = await vault().write(path, encode(body, DEFAULT_SHAPE))
  await forgetEmptyFolder(input.folder)
  // The catalog has to know the note before its pictures are named after it.
  set({ files: await vault().catalog() })
  if (input.images.length > 0) {
    const embeds: string[] = []
    for (const image of input.images) {
      embeds.push(`![[${await attachImage(file.fileId, image.bytes, image.extension)}]]`)
    }
    const text = (body ? body + '\n' : '') + embeds.join('\n') + '\n'
    const saved = await vault().write(path, encode(text, DEFAULT_SHAPE))
    written.set(file.fileId, saved.hash)
  }
  await changed()
  return file.fileId
}

/* ------------------------------------------- icons and environments */

/** The versions of the settings files that are loaded, to read them only when they change. */
let settingsSeen = ''
let settingsLoading = false

const SETTINGS_FILES = [ICONS_FILE, ICONIZE_FILE, ENVIRONMENTS_FILE, BOOKMARKS_FILE]

/**
 * Reads the icons and the environments from the files the desktop keeps in the
 * vault. The icons are the app's own, or Iconize's while the app has none. The
 * environments come from the folders at the root, less the ones set aside.
 */
async function loadVaultSettings(): Promise<void> {
  if (settingsLoading || !mirror) return
  const catalog = snapshot.files
  const hashOf = (path: string) => catalog.find((file) => file.path === path)?.hash ?? ''
  const roots = [
    ...new Set([
      ...catalog.filter((file) => file.path.includes('/')).map((file) => file.path.split('/')[0]!),
      ...snapshot.folders.map((folder) => folder.split('/')[0]!),
    ]),
  ]
  const seen = SETTINGS_FILES.map(hashOf).join('|') + '|' + roots.toSorted().join('/')
  if (seen === settingsSeen) return
  settingsLoading = true
  try {
    // A file that is in the vault and could not be fetched (no network) is
    // tried again on the next pass, instead of being taken for an empty one.
    let missed = false
    const text = async (path: string) => {
      if (!hashOf(path)) return null
      try {
        return decode(await vault().open(path)).text
      } catch {
        missed = true
        return null
      }
    }
    const own = await text(ICONS_FILE)
    let icons = own === null ? null : parseIcons(own)
    if (!icons) {
      const iconize = await text(ICONIZE_FILE)
      icons = iconize === null ? {} : parseIconize(iconize)
    }
    const config: EnvironmentsConfig = parseEnvironments((await text(ENVIRONMENTS_FILE)) ?? '')
    set({
      icons,
      environments: environmentsOf(roots, config),
      environmentColors: config.colors,
      bookmarks: bookmarkedFiles(await text(BOOKMARKS_FILE)).map((file) => file.path),
    })
    if (!missed) settingsSeen = seen
  } finally {
    settingsLoading = false
  }
}

/** Writes the icons to the app's own file, when they changed. */
async function writeIcons(icons: IconMap): Promise<void> {
  if (icons === snapshot.icons) return
  set({ icons })
  await vault().write(ICONS_FILE, new TextEncoder().encode(serializeIcons(icons)))
}

/** The environment a path is in, or null. */
export function environmentOf(path: string, environments: string[]): string | null {
  const root = path.split('/')[0]!
  return environments.includes(root) ? root : null
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
        (stats) =>
          (stats.totalMs > 500 ? log.info : log.debug)('indice', 'construido', { ...stats }),
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
    /** The whole catalog at once: a walk folder by folder rescans it per folder. */
    async scan() {
      return catalog.map((file) => ({ path: file.path, size: file.size, modifiedAt: file.mtime }))
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
