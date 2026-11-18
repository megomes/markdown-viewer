/**
 * The phone's and the tablet's copy of the vault (docs/spec.md, section 6.8).
 *
 * It follows the server's log like the engine does, with two differences that
 * come from the device:
 *
 * - **It does not keep everything.** There is a catalog of every file in the
 *   vault, with what is needed to fetch it later (the sealed chunk ids). Text,
 *   HTML and small images are downloaded as soon as they change; PDFs and
 *   anything large only when opened, and then kept (section 6.5, "Por aparelho").
 * - **It never infers a change from the folder.** The engine compares the
 *   folder with what it last synced, so a missing file is a deletion. Here a
 *   file that is not on the device is the normal case, and storage that was
 *   wiped or half written must never reach the vault. So the only commits are
 *   the ones the person asked for through `write`, `move` and `remove`, kept in
 *   the state until the server accepts them: edits made offline wait there.
 *
 * When a file changed here and on the server, text is merged like the engine
 * does and anything else keeps a conflict copy.
 */

import type { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { chunk } from './chunker'
import { conflictPath, isText, randomId, type LocalFiles } from './engine'
import { mergeText } from './merge'
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
  /** Set while the device has something of this file the server has not accepted yet. */
  pending?: Pending
}

/** The server's version this file was changed from, as agreed at `seq`. */
export interface AgreedVersion {
  path: string
  hash: string
  chunks: string[]
  size: number
  mtime: number
}

export interface Pending {
  /** Null for a file created on this device. */
  base: AgreedVersion | null
  /** Deleted here: the record stays until the server accepts the deletion. */
  deleted?: boolean
}

export interface MirrorState {
  version: 1
  cursor: number
  files: Record<string, MirrorFile>
}

export interface MirrorStore {
  load(): Promise<MirrorState | null>
  save(state: MirrorState): Promise<void>
  /** The agreed text of a file edited here: the base of a three-way merge. */
  getBase(fileId: string): Promise<Uint8Array | null>
  setBase(fileId: string, bytes: Uint8Array | null): Promise<void>
}

export interface MirrorProgress {
  /** Coming down from the server, or going up to it. */
  direction: 'download' | 'upload'
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
  /** Changes made on this device that the server accepted. */
  pushed: number
  /** Conflict copies written in this pass. */
  conflicts: string[]
}

export interface MirrorOptions {
  files: LocalFiles
  store: MirrorStore
  remote: Remote
  crypto: VaultCrypto
  /** Which files come down as soon as they change. Defaults to `downloadsEagerly`. */
  eager?: (meta: FileMeta) => boolean
  onProgress?: (progress: MirrorProgress) => void
  /** A short name for this device, used in conflict copies. */
  deviceName?: string
  now?: () => Date
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

const decoder = new TextDecoder('utf-8', { fatal: false })
const encoder = new TextEncoder()

export class VaultMirror {
  private state: MirrorState | null = null
  private running: Promise<MirrorReport> | null = null
  /** Files being fetched on demand, so two taps download once. */
  private fetching = new Map<string, Promise<Uint8Array>>()
  /** Changes to the state wait their turn: an edit never lands in the middle of a pass's step. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: MirrorOptions) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => {})
    return run
  }

  private async loadState(): Promise<MirrorState> {
    this.state ??= (await this.options.store.load()) ?? { version: 1, cursor: 0, files: {} }
    return this.state
  }

  private async saveState(): Promise<void> {
    if (this.state) await this.options.store.save(this.state)
  }

  /** Every file in the vault, downloaded or not. Files deleted here are already gone. */
  async catalog(): Promise<MirrorFile[]> {
    return Object.values((await this.loadState()).files).filter((file) => !file.pending?.deleted)
  }

  async fileAt(path: string): Promise<MirrorFile | null> {
    return (await this.catalog()).find((file) => file.path === path) ?? null
  }

  /** How many files have a change the server has not accepted yet. */
  async pendingCount(): Promise<number> {
    return Object.values((await this.loadState()).files).filter((file) => file.pending).length
  }

  /** One pass, never two at once: a call during a pass waits for it. */
  sync(): Promise<MirrorReport> {
    this.running ??= this.passes().finally(() => {
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
    if (file.local) {
      try {
        return await this.options.files.read(file.path)
      } catch {
        // Gone from the device behind the catalog's back (a version before
        // 0.15.0 deleting a repeated copy took the file with it): the server
        // still has it.
        file.local = false
      }
    }
    const pending = this.fetching.get(file.fileId)
    if (pending) return pending
    const fetch = (async () => {
      const bytes = await this.contentOf(file.chunks)
      // A pass may have replaced the version while it came down.
      const now = this.state?.files[file.fileId]
      if (!now || now.hash !== file.hash || now.pending?.deleted) return bytes
      await this.options.files.write(now.path, bytes)
      now.local = true
      await this.saveState()
      return bytes
    })().finally(() => this.fetching.delete(file.fileId))
    this.fetching.set(file.fileId, fetch)
    return fetch
  }

  /* ------------------------------------------------ changes made here */

  private now(): number {
    return (this.options.now?.() ?? new Date()).getTime()
  }

  private liveAt(state: MirrorState, path: string): MirrorFile | undefined {
    return Object.values(state.files).find((file) => file.path === path && !file.pending?.deleted)
  }

  /** Marks a file as changed here, keeping what the server's version was. */
  private async touch(file: MirrorFile): Promise<Pending> {
    if (file.pending) return file.pending
    file.pending = {
      base: {
        path: file.path,
        hash: file.hash,
        chunks: file.chunks,
        size: file.size,
        mtime: file.mtime,
      },
    }
    if (file.local && isText(file.path))
      await this.options.store.setBase(file.fileId, await this.options.files.read(file.path))
    return file.pending
  }

  /** Back to what the server has: nothing left to send. */
  private async settleIfSame(file: MirrorFile): Promise<void> {
    const base = file.pending?.base
    if (!base || file.pending?.deleted) return
    if (file.hash !== base.hash || file.path !== base.path) return
    file.chunks = base.chunks
    delete file.pending
    await this.options.store.setBase(file.fileId, null)
  }

  /**
   * Saves a file on the device, new or existing. It reaches the server in the
   * next pass, and waits on the device for as long as there is no network.
   */
  write(path: string, bytes: Uint8Array): Promise<MirrorFile> {
    return this.exclusive(async () => {
      const state = await this.loadState()
      let file = this.liveAt(state, path)
      if (file) await this.touch(file)
      else {
        file = {
          fileId: randomId(),
          path,
          seq: 0,
          size: 0,
          mtime: 0,
          hash: '',
          chunks: [],
          local: true,
          pending: { base: null },
        }
        state.files[file.fileId] = file
      }
      await this.options.files.write(path, bytes)
      file.size = bytes.length
      file.mtime = this.now()
      file.hash = this.options.crypto.hash(bytes)
      file.local = true
      await this.settleIfSame(file)
      await this.saveState()
      return file
    })
  }

  /** Renames or moves one file. Fails when the destination is taken. */
  move(from: string, to: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.loadState()
      const file = this.liveAt(state, from)
      if (!file) throw new Error('Arquivo fora do vault: ' + from)
      if (from === to) return
      if (this.liveAt(state, to)) throw new Error('Já existe um arquivo em ' + to)
      await this.touch(file)
      if (file.local) await this.options.files.move(from, to)
      file.path = to
      await this.settleIfSame(file)
      await this.saveState()
    })
  }

  /** Deletes one file here; the vault follows when the server accepts it. */
  remove(path: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.loadState()
      const file = this.liveAt(state, path)
      if (!file) return
      if (file.local) await this.options.files.remove(file.path).catch(() => {})
      file.local = false
      if (file.seq === 0) {
        // Never left this device: there is nothing to tell the server.
        delete state.files[file.fileId]
        await this.options.store.setBase(file.fileId, null)
      } else {
        const pending = await this.touch(file)
        pending.deleted = true
        await this.options.store.setBase(file.fileId, null)
      }
      await this.saveState()
    })
  }

  /* ------------------------------------------------------------ passes */

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

  /** Pull then push, again while the server refuses a commit because it moved on. */
  private async passes(): Promise<MirrorReport> {
    const report: MirrorReport = { changed: 0, paths: [], pushed: 0, conflicts: [] }
    for (let round = 0; round < 4; round++) {
      await this.pull(report)
      if (!(await this.push(report))) break
    }
    return report
  }

  private async pull(report: MirrorReport): Promise<void> {
    const state = await this.loadState()
    const entries = await this.options.remote.changes(state.cursor)
    // Only the newest entry of each file matters; older ones are history.
    const latest = new Map<string, RemoteEntry>()
    for (const entry of entries) latest.set(entry.fileId, entry)

    let done = 0
    // The state of a big vault is a megabyte of JSON. Written after every
    // entry, a thousand deletions kept the phone busy for minutes; once a
    // second is enough, since an entry applied twice after a crash lands the same.
    let saved = Date.now()
    for (const entry of latest.values()) {
      done++
      await this.exclusive(async () => {
        const record = state.files[entry.fileId]
        if (record && entry.seq <= record.seq) return
        const path = await this.apply(state, entry, record, report)
        this.options.onProgress?.({ direction: 'download', done, total: latest.size, path })
        report.changed++
        report.paths.push(path)
        if (Date.now() - saved < 1000) return
        await this.saveState()
        saved = Date.now()
      })
    }
    if (entries.length) state.cursor = Math.max(state.cursor, entries[entries.length - 1]!.seq)
    await this.saveState()
  }

  /** Sends what changed here. Resolves to true when a commit was refused and a new pull is due. */
  private async push(report: MirrorReport): Promise<boolean> {
    const state = await this.loadState()
    let again = false
    const total = Object.values(state.files).filter((file) => file.pending).length
    let done = 0
    for (const id of Object.keys(state.files)) {
      const refused = await this.exclusive(async () => {
        const file = state.files[id]
        if (!file?.pending) return false
        const deleted = file.pending.deleted === true
        const result = deleted
          ? await this.options.remote.commit({
              fileId: id,
              parent: file.seq,
              meta: null,
              deleted: true,
            })
          : await this.options.remote.commit({
              fileId: id,
              parent: file.seq || null,
              meta: await this.upload(file),
              deleted: false,
            })
        if (!result.ok) return true
        report.pushed++
        this.options.onProgress?.({ direction: 'upload', done: ++done, total, path: file.path })
        if (deleted) delete state.files[id]
        else {
          file.seq = result.seq
          delete file.pending
        }
        await this.options.store.setBase(id, null)
        await this.saveState()
        return false
      })
      again ||= refused
    }
    return again
  }

  /** Puts the file's chunks on the server and seals its metadata. */
  private async upload(file: MirrorFile): Promise<string> {
    const { crypto, remote, files } = this.options
    if (file.local) {
      const bytes = await files.read(file.path)
      const pieces = chunk(bytes)
      const ids = pieces.map((piece) => crypto.chunkId(piece))
      const missing = new Set(await remote.missingChunks([...new Set(ids)]))
      for (let i = 0; i < pieces.length; i++) {
        const id = ids[i]!
        if (!missing.has(id)) continue
        await remote.putChunk(id, crypto.seal(pieces[i]!))
        missing.delete(id)
      }
      file.chunks = ids
      file.size = bytes.length
      file.hash = crypto.hash(bytes)
    }
    // Not on the device: only its path changed, the chunks are the server's own.
    const meta: FileMeta = {
      path: file.path,
      size: file.size,
      mtime: file.mtime,
      hash: file.hash,
      chunks: file.chunks,
    }
    return crypto.sealJson(meta)
  }

  /** Moves a file of this device out of the way of one arriving at its path. */
  private async aside(state: MirrorState, file: MirrorFile, report: MirrorReport): Promise<void> {
    const device = this.options.deviceName ?? 'celular'
    const when = this.options.now?.() ?? new Date()
    const from = file.path
    file.path = ''
    let target = conflictPath(from, device, when)
    for (let i = 2; this.liveAt(state, target); i++)
      target = conflictPath(from, `${device} ${i}`, when)
    file.path = from
    await this.touch(file)
    if (file.local) await this.options.files.move(from, target)
    report.conflicts.push(target)
    report.paths.push(from, target)
    file.path = target
  }

  /** Applies one entry; resolves to the path it touched. */
  private async apply(
    state: MirrorState,
    entry: RemoteEntry,
    record: MirrorFile | undefined,
    report: MirrorReport,
  ): Promise<string> {
    const { files, crypto, store } = this.options

    if (entry.deleted) {
      if (!record) return ''
      if (record.pending && !record.pending.deleted) {
        // Edited here, deleted there: the edit wins and the file comes back.
        record.seq = entry.seq
        record.pending.base = null
        return record.path
      }
      // A copy of the same file under another id keeps what is on the device.
      const shared = Object.values(state.files).some(
        (file) => file.fileId !== entry.fileId && file.path === record.path,
      )
      if (record.local && !shared) await files.remove(record.path).catch(() => {})
      delete state.files[entry.fileId]
      await store.setBase(entry.fileId, null)
      return record.path
    }

    const meta = crypto.openJson<FileMeta>(entry.meta!)

    if (record?.pending?.deleted) {
      // Deleted here, changed there: their change wins and the file comes back.
      delete record.pending
      record.local = false
    }
    if (record?.pending) return this.reconcile(state, entry, meta, record, report)

    // A file made on this device sits where this one arrives.
    const occupant = this.liveAt(state, meta.path)
    if (occupant && occupant.fileId !== entry.fileId && occupant.pending) {
      if (occupant.seq === 0 && occupant.hash === meta.hash) {
        // The same file created on both sides: it is one file, theirs.
        delete state.files[occupant.fileId]
        await store.setBase(occupant.fileId, null)
      } else await this.aside(state, occupant, report)
    }

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

  /**
   * A file changed here and on the server. Text is joined line by line against
   * the version both had; when the same lines changed, the server's version
   * takes the place and this device's is kept beside it as a conflict copy.
   * Nothing written here is ever dropped.
   */
  private async reconcile(
    state: MirrorState,
    entry: RemoteEntry,
    meta: FileMeta,
    record: MirrorFile,
    report: MirrorReport,
  ): Promise<string> {
    const { files, crypto, store } = this.options
    const base = record.pending!.base
    const editedHere = !base || record.hash !== base.hash
    const movedHere = !!base && record.path !== base.path
    const editedThere = !base || meta.hash !== base.hash
    const movedThere = !!base && meta.path !== base.path
    const eager = (this.options.eager ?? downloadsEagerly)(meta)
    let remoteBytes: Uint8Array | null = null

    const takeTheirs = async () => {
      if (eager) {
        remoteBytes ??= await this.contentOf(meta.chunks)
        await files.write(record.path, remoteBytes)
        record.local = true
      } else if (record.local) {
        await files.remove(record.path).catch(() => {})
        record.local = false
      }
      record.hash = meta.hash
      record.size = meta.size
      record.mtime = meta.mtime
      record.chunks = meta.chunks
    }

    if (record.hash === meta.hash) {
      record.chunks = meta.chunks
    } else if (!editedHere) {
      await takeTheirs()
    } else if (editedThere) {
      let merged: string | null = null
      const agreed = isText(record.path) && record.local ? await store.getBase(entry.fileId) : null
      if (agreed) {
        remoteBytes = await this.contentOf(meta.chunks)
        merged = mergeText(
          decoder.decode(agreed),
          decoder.decode(await files.read(record.path)),
          decoder.decode(remoteBytes),
        )
      }
      if (merged !== null) {
        const bytes = encoder.encode(merged)
        await files.write(record.path, bytes)
        record.hash = crypto.hash(bytes)
        record.size = bytes.length
        record.mtime = this.now()
        if (record.hash === meta.hash) record.chunks = meta.chunks
      } else if (record.local) {
        // No merge: this device's version becomes a file of its own, beside the server's.
        const original = record.path
        const copy: MirrorFile = {
          fileId: randomId(),
          path: original,
          seq: 0,
          size: record.size,
          mtime: record.mtime,
          hash: record.hash,
          chunks: [],
          local: true,
          pending: { base: null },
        }
        state.files[copy.fileId] = copy
        await this.aside(state, copy, report)
        record.local = false
        await takeTheirs()
      } else await takeTheirs()
    }

    // Where it lives: this device's rename stands unless the other side renamed it too.
    const target = movedHere && !movedThere ? record.path : meta.path
    if (target !== record.path) {
      const occupant = this.liveAt(state, target)
      if (occupant && occupant.fileId !== record.fileId) await this.aside(state, occupant, report)
      if (record.local) await files.move(record.path, target)
      report.paths.push(record.path)
      record.path = target
    }

    record.seq = entry.seq
    if (record.hash === meta.hash && record.path === meta.path) {
      delete record.pending
      await store.setBase(entry.fileId, null)
    } else {
      record.pending = {
        base: {
          path: meta.path,
          hash: meta.hash,
          chunks: meta.chunks,
          size: meta.size,
          mtime: meta.mtime,
        },
      }
      if (isText(record.path) && record.local) {
        remoteBytes ??= await this.contentOf(meta.chunks)
        await store.setBase(entry.fileId, remoteBytes)
      }
    }
    return record.path
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
  readonly bases = new Map<string, Uint8Array>()
  async getBase(id: string) {
    return this.bases.get(id) ?? null
  }
  async setBase(id: string, bytes: Uint8Array | null) {
    if (bytes) this.bases.set(id, bytes.slice())
    else this.bases.delete(id)
  }
}
