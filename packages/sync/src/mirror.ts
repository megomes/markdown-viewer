/**
 * A read-only copy of the vault, for the phone and the tablet (docs/spec.md,
 * section 6.8).
 *
 * It follows the server's log like the engine does, but it never commits: a
 * device that only reads cannot delete or overwrite anything in the vault, even
 * when its own storage is wiped or half written. That is why it is a class of
 * its own and not the engine with a flag.
 *
 * It keeps a catalog of every file in the vault, with what is needed to fetch
 * it later (the sealed chunk ids). Text, HTML and small images are downloaded as
 * soon as they change; PDFs and anything large only when opened, and then kept
 * (section 6.5, "Por aparelho").
 */

import type { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { isText, type LocalFiles } from './engine'
import type { FileMeta, Remote, RemoteEntry } from './protocol'

export interface MirrorFile {
  fileId: string
  path: string
  seq: number
  size: number
  mtime: number
  hash: string
  chunks: string[]
  /** Whether this version is on the device. */
  local: boolean
}

export interface MirrorState {
  version: 1
  cursor: number
  files: Record<string, MirrorFile>
}

export interface MirrorStore {
  load(): Promise<MirrorState | null>
  save(state: MirrorState): Promise<void>
}

export interface MirrorProgress {
  /** Entries applied in this pass so far, and how many there are. */
  done: number
  total: number
  path: string
}

export interface MirrorReport {
  /** Files downloaded, moved, removed or newly listed in this pass. */
  changed: number
  /** Paths whose content changed on the device, for the screens that show them. */
  paths: string[]
}

export interface MirrorOptions {
  files: LocalFiles
  store: MirrorStore
  remote: Remote
  crypto: VaultCrypto
  /** Which files come down as soon as they change. Defaults to `downloadsEagerly`. */
  eager?: (meta: FileMeta) => boolean
  onProgress?: (progress: MirrorProgress) => void
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i
/** Above this, even text waits to be opened: a log or a dump, not a note. */
export const EAGER_TEXT_LIMIT = 20 * 1024 * 1024
/** "Imagem pequena": a photo pasted into a note, not a scan. */
export const EAGER_IMAGE_LIMIT = 2 * 1024 * 1024

/** Text, HTML and small images: what a note needs to be read offline. */
export function downloadsEagerly(meta: Pick<FileMeta, 'path' | 'size'>): boolean {
  if (isText(meta.path)) return meta.size <= EAGER_TEXT_LIMIT
  if (IMAGE.test(meta.path)) return meta.size <= EAGER_IMAGE_LIMIT
  return false
}

export class ReadOnlyMirror {
  private state: MirrorState | null = null
  private running: Promise<MirrorReport> | null = null
  /** Files being fetched on demand, so two taps download once. */
  private fetching = new Map<string, Promise<Uint8Array>>()

  constructor(private readonly options: MirrorOptions) {}

  private async loadState(): Promise<MirrorState> {
    this.state ??= (await this.options.store.load()) ?? { version: 1, cursor: 0, files: {} }
    return this.state
  }

  private async saveState(): Promise<void> {
    if (this.state) await this.options.store.save(this.state)
  }

  /** Every file in the vault, downloaded or not. */
  async catalog(): Promise<MirrorFile[]> {
    return Object.values((await this.loadState()).files)
  }

  async fileAt(path: string): Promise<MirrorFile | null> {
    return (await this.catalog()).find((file) => file.path === path) ?? null
  }

  /** One pass, never two at once: a call during a pass waits for it. */
  sync(): Promise<MirrorReport> {
    this.running ??= this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }

  /**
   * The content of a file, downloading it first when it is not on the device.
   * What was downloaded stays, and follows later versions like the rest.
   */
  async open(path: string): Promise<Uint8Array> {
    const file = await this.fileAt(path)
    if (!file) throw new Error('Arquivo fora do vault: ' + path)
    if (file.local) return this.options.files.read(file.path)
    const pending = this.fetching.get(file.fileId)
    if (pending) return pending
    const fetch = (async () => {
      const bytes = await this.contentOf(file.chunks)
      // A pass may have replaced the version while it came down.
      const now = this.state?.files[file.fileId]
      if (!now || now.hash !== file.hash) return bytes
      await this.options.files.write(now.path, bytes)
      now.local = true
      await this.saveState()
      return bytes
    })().finally(() => this.fetching.delete(file.fileId))
    this.fetching.set(file.fileId, fetch)
    return fetch
  }

  private async contentOf(chunks: string[]): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    for (const id of chunks)
      parts.push(this.options.crypto.open(await this.options.remote.getChunk(id)))
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }

  private async pass(): Promise<MirrorReport> {
    const state = await this.loadState()
    const report: MirrorReport = { changed: 0, paths: [] }
    const entries = await this.options.remote.changes(state.cursor)
    // Only the newest entry of each file matters; older ones are history.
    const latest = new Map<string, RemoteEntry>()
    for (const entry of entries) latest.set(entry.fileId, entry)

    let done = 0
    for (const entry of latest.values()) {
      done++
      const record = state.files[entry.fileId]
      if (record && entry.seq <= record.seq) continue
      const path = await this.apply(state, entry, record)
      this.options.onProgress?.({ done, total: latest.size, path })
      report.changed++
      report.paths.push(path)
      await this.saveState()
    }
    if (entries.length) state.cursor = Math.max(state.cursor, entries[entries.length - 1]!.seq)
    await this.saveState()
    return report
  }

  /** Applies one entry; resolves to the path it touched. */
  private async apply(
    state: MirrorState,
    entry: RemoteEntry,
    record: MirrorFile | undefined,
  ): Promise<string> {
    const { files, crypto } = this.options

    if (entry.deleted) {
      if (!record) return ''
      if (record.local) await files.remove(record.path).catch(() => {})
      delete state.files[entry.fileId]
      return record.path
    }

    const meta = crypto.openJson<FileMeta>(entry.meta!)
    const eager = (this.options.eager ?? downloadsEagerly)(meta)
    const same = record?.hash === meta.hash
    let local = record?.local === true && same

    // Moved: the copy on the device follows, or goes if it is out of date.
    if (record?.local && record.path !== meta.path) {
      if (same) await files.move(record.path, meta.path)
      else await files.remove(record.path).catch(() => {})
    } else if (record?.local && !same && !eager) {
      // A newer version that waits to be opened: the old one would be shown as current.
      await files.remove(record.path).catch(() => {})
      local = false
    }

    if (eager && !local) {
      await files.write(meta.path, await this.contentOf(meta.chunks))
      local = true
    }

    state.files[entry.fileId] = {
      fileId: entry.fileId,
      path: meta.path,
      seq: entry.seq,
      size: meta.size,
      mtime: meta.mtime,
      hash: meta.hash,
      chunks: meta.chunks,
      local,
    }
    return meta.path
  }
}

/** A store in memory, for tests. */
export class MemoryMirrorStore implements MirrorStore {
  state: MirrorState | null = null
  async load() {
    return this.state ? (JSON.parse(JSON.stringify(this.state)) as MirrorState) : null
  }
  async save(state: MirrorState) {
    this.state = JSON.parse(JSON.stringify(state)) as MirrorState
  }
}
