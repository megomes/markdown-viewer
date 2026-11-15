/**
 * The sync engine of one device.
 *
 * A pass has two halves:
 *
 * 1. **Pull.** Every entry the server accepted since this device last looked is
 *    applied: new files are written, changed files rewritten, moved files moved,
 *    deleted files deleted. When the file also changed here, the two edits are
 *    joined (text) or kept side by side (anything else). Nothing local is ever
 *    overwritten without being kept somewhere.
 * 2. **Push.** The folder is compared with what this device last synced: new,
 *    edited, moved and deleted files become commits, each on top of the version
 *    it was made from. A commit the server refuses (someone got there first)
 *    ends the pass early, and the next pass pulls and merges it.
 *
 * The engine knows nothing of Tauri, Expo or Node. It talks to the folder, to its
 * own saved state and to the server through the three small interfaces below.
 */

import type { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { chunk } from './chunker'
import { mergeState, mergeText } from './merge'
import type { FileMeta, Remote, RemoteEntry } from './protocol'

export interface LocalStat {
  path: string
  size: number
  mtime: number
}

/** The synced folder. Paths are vault paths, `/`-separated. */
export interface LocalFiles {
  /** Every file under the folder, ignores already applied. */
  list(): Promise<LocalStat[]>
  read(path: string): Promise<Uint8Array>
  /** Creates parent folders as needed. */
  write(path: string, bytes: Uint8Array): Promise<LocalStat>
  /** Sends to the trash where the platform has one. */
  remove(path: string): Promise<void>
  move(from: string, to: string): Promise<void>
}

export interface FileRecord {
  path: string
  /** The entry this device's copy matches. */
  seq: number
  hash: string
  size: number
  mtime: number
}

export interface SyncState {
  device: string
  cursor: number
  files: Record<string, FileRecord>
}

/** Where a device keeps its sync state and the agreed text of each file. */
export interface StateStore {
  load(): Promise<SyncState | null>
  save(state: SyncState): Promise<void>
  /** The last agreed content of a text file: the base of a three-way merge. */
  getBase(fileId: string): Promise<Uint8Array | null>
  setBase(fileId: string, bytes: Uint8Array | null): Promise<void>
}

export interface SyncEvent {
  kind: 'pulled' | 'pushed' | 'merged' | 'conflict' | 'deleted' | 'moved'
  path: string
  detail?: string
}

export interface SyncReport {
  pulled: number
  pushed: number
  events: SyncEvent[]
  /** The server refused a commit: another pass is needed to catch up. */
  again: boolean
}

const TEXT =
  /\.(md|markdown|txt|html?|css|js|mjs|ts|json|ya?ml|csv|tsv|xml|svg|py|lua|sh|ps1|bat|ini|toml|log|base|canvas)$/i
const STATE_FILE = /^\.markdown-viewer\/state\/.+\.json$/

/** Text files merge line by line; everything else is kept whole. */
export function isText(path: string): boolean {
  return TEXT.test(path)
}

const decoder = new TextDecoder('utf-8', { fatal: false })
const encoder = new TextEncoder()

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `Nota (conflito S25 2026-10-05 0130).md`, beside the file it came from. */
export function conflictPath(path: string, device: string, when: Date): string {
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}${pad(when.getMinutes())}`
  return `${path.slice(0, slash + 1)}${stem} (conflito ${device} ${stamp})${ext}`
}

export interface EngineOptions {
  files: LocalFiles
  store: StateStore
  remote: Remote
  crypto: VaultCrypto
  /** A short name for this device, used in conflict copies. */
  deviceName: string
  now?: () => Date
}

export class SyncEngine {
  private state: SyncState | null = null
  private running: Promise<SyncReport> | null = null

  constructor(private readonly options: EngineOptions) {}

  private async loadState(): Promise<SyncState> {
    this.state ??= (await this.options.store.load()) ?? { device: randomId(), cursor: 0, files: {} }
    return this.state
  }

  private async saveState(): Promise<void> {
    if (this.state) await this.options.store.save(this.state)
  }

  /** One pass, never two at once: a call during a pass waits for it. */
  sync(): Promise<SyncReport> {
    this.running ??= this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Passes until the server has nothing new and this device nothing to send. */
  async syncUntilQuiet(maxPasses = 6): Promise<SyncReport> {
    const total: SyncReport = { pulled: 0, pushed: 0, events: [], again: false }
    for (let i = 0; i < maxPasses; i++) {
      const report = await this.sync()
      total.pulled += report.pulled
      total.pushed += report.pushed
      total.events.push(...report.events)
      if (!report.again && report.pulled === 0 && report.pushed === 0) break
    }
    return total
  }

  private async pass(): Promise<SyncReport> {
    const state = await this.loadState()
    const report: SyncReport = { pulled: 0, pushed: 0, events: [], again: false }
    const disk = new Map((await this.options.files.list()).map((stat) => [stat.path, stat]))
    await this.pull(state, disk, report)
    const after = new Map((await this.options.files.list()).map((stat) => [stat.path, stat]))
    await this.push(state, after, report)
    return report
  }

  /* -------------------------------------------------------------- reading */

  private async contentOf(meta: FileMeta): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    for (const id of meta.chunks)
      parts.push(this.options.crypto.open(await this.options.remote.getChunk(id)))
    const total = parts.reduce((n, part) => n + part.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }

  /** Whether the file at a record's path is still what was synced. */
  private async localState(
    record: FileRecord,
    disk: Map<string, LocalStat>,
  ): Promise<{ status: 'clean' | 'changed' | 'missing'; bytes?: Uint8Array }> {
    const stat = disk.get(record.path)
    if (!stat) return { status: 'missing' }
    if (stat.size === record.size && stat.mtime === record.mtime) return { status: 'clean' }
    const bytes = await this.options.files.read(record.path)
    if (this.options.crypto.hash(bytes) === record.hash) {
      // Touched but not changed: remember the new stamp, it is still clean.
      record.mtime = stat.mtime
      record.size = stat.size
      return { status: 'clean', bytes }
    }
    return { status: 'changed', bytes }
  }

  private async writeLocal(
    path: string,
    bytes: Uint8Array,
    disk: Map<string, LocalStat>,
  ): Promise<LocalStat> {
    const stat = await this.options.files.write(path, bytes)
    disk.set(path, stat)
    return stat
  }

  private async keepAsConflict(
    path: string,
    bytes: Uint8Array,
    disk: Map<string, LocalStat>,
    report: SyncReport,
    origin: string,
  ): Promise<void> {
    const now = this.options.now?.() ?? new Date()
    let target = conflictPath(path, origin, now)
    for (let i = 2; disk.has(target); i++) target = conflictPath(path, `${origin} ${i}`, now)
    await this.writeLocal(target, bytes, disk)
    report.events.push({ kind: 'conflict', path, detail: target })
  }

  /* ----------------------------------------------------------------- pull */

  private async pull(
    state: SyncState,
    disk: Map<string, LocalStat>,
    report: SyncReport,
  ): Promise<void> {
    const entries = await this.options.remote.changes(state.cursor)
    // Only the newest entry of each file matters; older ones are history.
    const latest = new Map<string, RemoteEntry>()
    for (const entry of entries) latest.set(entry.fileId, entry)

    for (const entry of latest.values()) {
      const record = state.files[entry.fileId]
      if (record && entry.seq <= record.seq) continue
      await this.applyRemote(state, entry, record, disk, report)
      report.pulled++
      await this.saveState()
    }
    if (entries.length) state.cursor = Math.max(state.cursor, entries[entries.length - 1]!.seq)
    await this.saveState()
  }

  private async applyRemote(
    state: SyncState,
    entry: RemoteEntry,
    record: FileRecord | undefined,
    disk: Map<string, LocalStat>,
    report: SyncReport,
  ): Promise<void> {
    const { files, store, crypto } = this.options
    const local = record ? await this.localState(record, disk) : null

    if (entry.deleted) {
      if (!record) return
      if (local?.status === 'changed') {
        // Edited here, deleted there: the edit wins and the file comes back.
        record.seq = entry.seq
        record.hash = '' // forces the push to send it again
        return
      }
      if (local?.status === 'clean') {
        await files.remove(record.path)
        disk.delete(record.path)
        report.events.push({ kind: 'deleted', path: record.path })
      }
      delete state.files[entry.fileId]
      await store.setBase(entry.fileId, null)
      return
    }

    const meta = crypto.openJson<FileMeta>(entry.meta!)
    const remoteBytes = await this.contentOf(meta)
    const remember = async (path: string, bytes: Uint8Array, stat: LocalStat) => {
      state.files[entry.fileId] = {
        path,
        seq: entry.seq,
        hash: meta.hash,
        size: stat.size,
        mtime: stat.mtime,
      }
      await store.setBase(entry.fileId, isText(path) ? bytes : null)
    }

    // A file this device has never seen.
    if (!record) {
      const occupant = disk.get(meta.path)
      if (occupant) {
        const mine = await files.read(meta.path)
        if (crypto.hash(mine) === meta.hash) {
          await remember(meta.path, remoteBytes, occupant)
          return
        }
        // Two devices created the same path: theirs takes it, ours moves aside.
        await this.keepAsConflict(meta.path, mine, disk, report, this.options.deviceName)
      }
      const stat = await this.writeLocal(meta.path, remoteBytes, disk)
      await remember(meta.path, remoteBytes, stat)
      report.events.push({ kind: 'pulled', path: meta.path })
      return
    }

    // Moved there: follow it here first, unless something else took the place.
    if (meta.path !== record.path && local?.status !== 'missing') {
      if (!disk.has(meta.path)) {
        await files.move(record.path, meta.path)
        const stat = disk.get(record.path)!
        disk.delete(record.path)
        disk.set(meta.path, { ...stat, path: meta.path })
        report.events.push({ kind: 'moved', path: meta.path, detail: record.path })
        record.path = meta.path
      }
    }

    if (local?.status === 'changed' && meta.hash !== record.hash) {
      const mine = local.bytes!
      const base = await store.getBase(entry.fileId)
      let merged: string | null = null
      if (isText(meta.path) && base) {
        const join = STATE_FILE.test(meta.path) ? mergeState : mergeText
        merged = join(decoder.decode(base), decoder.decode(mine), decoder.decode(remoteBytes))
      }
      if (merged !== null) {
        const bytes = encoder.encode(merged)
        const stat = await this.writeLocal(record.path, bytes, disk)
        // Agreed with the server's version; the merged text is a local edit on
        // top of it, which the push sends.
        state.files[entry.fileId] = {
          path: record.path,
          seq: entry.seq,
          hash: meta.hash,
          size: -1,
          mtime: stat.mtime,
        }
        await store.setBase(entry.fileId, remoteBytes)
        report.events.push({ kind: 'merged', path: record.path })
        return
      }
      // No merge: the server's version takes the place, ours sits beside it.
      await this.keepAsConflict(record.path, mine, disk, report, this.options.deviceName)
    }

    if (local?.status === 'missing' || meta.hash !== record.hash || meta.path !== record.path) {
      // Another file took the place meanwhile: it moves aside, it is not overwritten.
      if (meta.path !== record.path && disk.has(meta.path)) {
        await this.keepAsConflict(
          meta.path,
          await files.read(meta.path),
          disk,
          report,
          this.options.deviceName,
        )
      }
      const stat = await this.writeLocal(meta.path, remoteBytes, disk)
      if (meta.path !== record.path && disk.has(record.path) && local?.status === 'clean') {
        await files.remove(record.path)
        disk.delete(record.path)
      }
      await remember(meta.path, remoteBytes, stat)
      report.events.push({ kind: 'pulled', path: meta.path })
      return
    }
    record.seq = entry.seq
  }

  /* ----------------------------------------------------------------- push */

  private async upload(path: string, bytes: Uint8Array, stat: LocalStat): Promise<string> {
    const { crypto, remote } = this.options
    const pieces = chunk(bytes)
    const ids = pieces.map((piece) => crypto.chunkId(piece))
    const missing = new Set(await remote.missingChunks([...new Set(ids)]))
    for (let i = 0; i < pieces.length; i++) {
      const id = ids[i]!
      if (!missing.has(id)) continue
      await remote.putChunk(id, crypto.seal(pieces[i]!))
      missing.delete(id)
    }
    const meta: FileMeta = {
      path,
      size: bytes.length,
      mtime: stat.mtime,
      hash: crypto.hash(bytes),
      chunks: ids,
    }
    return crypto.sealJson(meta)
  }

  private async push(
    state: SyncState,
    disk: Map<string, LocalStat>,
    report: SyncReport,
  ): Promise<void> {
    const { files, remote, crypto, store } = this.options
    const tracked = new Map<string, string>() // path -> fileId
    for (const [id, record] of Object.entries(state.files)) tracked.set(record.path, id)

    // What changed or went missing among the files this device knows.
    const missing: [string, FileRecord][] = []
    const changed: [string, FileRecord, Uint8Array][] = []
    for (const [id, record] of Object.entries(state.files)) {
      const local = await this.localState(record, disk)
      if (local.status === 'missing') missing.push([id, record])
      else if (local.status === 'changed' || record.hash === '') {
        changed.push([id, record, local.bytes ?? (await files.read(record.path))])
      }
    }

    // New files, and the ones among them that are a missing file moved.
    const created: [string, Uint8Array][] = []
    for (const [path] of disk) if (!tracked.has(path)) created.push([path, await files.read(path)])
    const moves: [string, FileRecord, string, Uint8Array][] = []
    // A copy: matches are taken out of `created` while this runs.
    for (const [path, bytes] of created.slice()) {
      const hash = crypto.hash(bytes)
      const at = missing.findIndex(([, record]) => record.hash === hash)
      if (at < 0) continue
      const [id, record] = missing.splice(at, 1)[0]!
      created.splice(
        created.findIndex(([p]) => p === path),
        1,
      )
      moves.push([id, record, path, bytes])
    }

    const send = async (id: string, record: FileRecord | null, path: string, bytes: Uint8Array) => {
      const stat = disk.get(path)!
      const meta = await this.upload(path, bytes, stat)
      const result = await remote.commit({
        fileId: id,
        parent: record?.seq ?? null,
        meta,
        deleted: false,
      })
      if (!result.ok) {
        report.again = true
        return false
      }
      state.files[id] = {
        path,
        seq: result.seq,
        hash: crypto.hash(bytes),
        size: stat.size,
        mtime: stat.mtime,
      }
      await store.setBase(id, isText(path) ? bytes : null)
      await this.saveState()
      report.pushed++
      report.events.push({ kind: 'pushed', path })
      return true
    }

    for (const [id, record, path, bytes] of moves) {
      if (!(await send(id, record, path, bytes))) return
      report.events.push({ kind: 'moved', path, detail: record.path })
    }
    for (const [id, record, bytes] of changed)
      if (!(await send(id, record, record.path, bytes))) return
    for (const [path, bytes] of created) if (!(await send(randomId(), null, path, bytes))) return
    for (const [id, record] of missing) {
      const result = await remote.commit({
        fileId: id,
        parent: record.seq,
        meta: null,
        deleted: true,
      })
      if (!result.ok) {
        report.again = true
        return
      }
      delete state.files[id]
      await store.setBase(id, null)
      await this.saveState()
      report.pushed++
      report.events.push({ kind: 'deleted', path: record.path })
    }
  }
}
