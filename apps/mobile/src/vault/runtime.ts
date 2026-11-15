/**
 * The vault on the phone, as the screens see it: paired or not, what is in it,
 * whether it is syncing. One instance for the whole app.
 *
 * It keeps the mirror up to date in three ways: when the app opens, when the
 * server says something changed (WebSocket), and when the app comes back to the
 * front. The index is the desktop's (`@markdown-viewer/core`), built from the
 * notes on the device, so links and aliases resolve the same way.
 */

import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { buildIndex, EMPTY_INDEX, type BaseIndex } from '@markdown-viewer/core/base-index'
import { decode } from '@markdown-viewer/core/text'
import type { Entry } from '@markdown-viewer/core/fs'
import { httpRemote, listen } from '@markdown-viewer/sync/http-remote'
import { ReadOnlyMirror, type MirrorFile, type MirrorProgress } from '@markdown-viewer/sync/mirror'
import { forgetPairing, loadPaired, pair, type Paired, type PairingCode } from './pairing'
import { PhoneFiles, PhoneMirrorStore, wipeLocalVault } from './storage'

/** The single base on the phone. Ids and links are made against it. */
export const VAULT_BASE = 'vault'

export interface VaultSnapshot {
  phase: 'loading' | 'unpaired' | 'ready'
  deviceName: string | null
  files: MirrorFile[]
  index: BaseIndex
  syncing: boolean
  progress: MirrorProgress | null
  lastSync: number | null
  error: string | null
}

let snapshot: VaultSnapshot = {
  phase: 'loading',
  deviceName: null,
  files: [],
  index: EMPTY_INDEX,
  syncing: false,
  progress: null,
  lastSync: null,
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
let mirror: ReadOnlyMirror | null = null
let stopListening: (() => void) | null = null
let started = false

async function open(paired: Paired): Promise<void> {
  const crypto = await VaultCrypto.create(paired.key)
  mirror = new ReadOnlyMirror({
    files,
    store: new PhoneMirrorStore(),
    remote: httpRemote(paired.connection),
    crypto,
    onProgress: (progress) => set({ progress }),
  })
  set({ phase: 'ready', deviceName: paired.deviceName, files: await mirror.catalog() })
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
  set({ phase: 'unpaired', files: [], index: EMPTY_INDEX, lastSync: null, deviceName: null })
}

export async function syncNow(): Promise<void> {
  const current = mirror
  if (!current) return
  set({ syncing: true, error: null })
  try {
    const report = await current.sync()
    set({ files: await current.catalog(), lastSync: Date.now() })
    if (report.changed > 0) void reindex()
  } catch (error) {
    // Offline is normal on a phone: what is on the device still opens.
    set({ error: messageOf(error) })
  } finally {
    set({ syncing: false, progress: null })
  }
}

/** The bytes of a file, downloaded first when it waits to be opened (PDFs). */
export async function readFile(path: string): Promise<Uint8Array> {
  if (!mirror) throw new Error('O vault não está pareado.')
  const bytes = await mirror.open(path)
  // A file fetched on demand is now on the device: the list says so.
  if (snapshot.files.find((file) => file.path === path)?.local === false) {
    set({ files: await mirror.catalog() })
  }
  return bytes
}

export async function readText(path: string): Promise<string> {
  return decode(await readFile(path)).text
}

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
  path: string
  name: string
  kind: 'file' | 'directory'
  /** For files: whether they are on the device already. */
  local: boolean
  size: number
}

/**
 * The folders and files directly inside `folder`, folders first, as in the
 * tree on the desktop. Folders exist only through the files in them: the server
 * knows files, not folders.
 */
export function childrenOf(catalog: MirrorFile[], folder: string): TreeNode[] {
  const prefix = folder ? folder + '/' : ''
  const dirs = new Map<string, TreeNode>()
  const out: TreeNode[] = []
  for (const file of catalog) {
    if (!file.path.startsWith(prefix)) continue
    const rest = file.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      out.push({ path: file.path, name: rest, kind: 'file', local: file.local, size: file.size })
      continue
    }
    const name = rest.slice(0, slash)
    if (!dirs.has(name)) {
      dirs.set(name, { path: prefix + name, name, kind: 'directory', local: true, size: 0 })
    }
  }
  const byName = (a: TreeNode, b: TreeNode) =>
    a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' })
  return [...[...dirs.values()].toSorted(byName), ...out.toSorted(byName)]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
