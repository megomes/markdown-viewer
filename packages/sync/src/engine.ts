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

export function randomId(): string {
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

/**
 * How far a pass is, for the progress bars of the sync screens: files coming
 * down from the server, or going up to it. Bytes are known for what goes up
 * (the sizes on the disk); what comes down is counted in files.
 */
export interface TransferProgress {
  direction: 'download' | 'upload'
  done: number
  total: number
  bytesDone: number
  bytesTotal: number
  /** The file being worked on. */
  path: string
  /** What the bar says instead of "Baixando" or "Enviando". */
  label?: string
}

export interface EngineOptions {
  /** Called as files come down and go up. */
  onProgress?: (progress: TransferProgress) => void
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

  private saving: Promise<void> = Promise.resolve()
  /** What the run under way has moved so far, each way, and what earlier passes had. */
  private moved = { download: { done: 0, bytes: 0 }, upload: { done: 0, bytes: 0 } }
  private carried = { download: { done: 0, bytes: 0 }, upload: { done: 0, bytes: 0 } }
  private inRun = false

  /** Reports progress as part of the whole run. */
  private progress(p: TransferProgress): void {
    const before = this.carried[p.direction]
    const done = before.done + p.done
    const bytes = before.bytes + p.bytesDone
    this.moved[p.direction] = { done, bytes }
    this.options.onProgress?.({
      ...p,
      done,
      total: before.done + p.total,
      bytesDone: bytes,
      bytesTotal: before.bytes + p.bytesTotal,
    })
  }
  private queued: Promise<void> | null = null

  /**
   * Saves one after the other, and folds a burst into one: files are sent a
   * few at a time, and a first sync of thousands used to write the whole state
   * once per file. A save asked for while one is waiting to start is that
   * same save, which will write the state as it is by then.
   *
   * A write the system refuses for a moment (on Windows, an antivirus or the
   * indexer holding the file just written) is tried again before giving up.
   */
  private saveState(): Promise<void> {
    if (this.queued) return this.queued
    const next = this.saving
      .catch(() => {})
      .then(async () => {
        this.queued = null
        if (!this.state) return
        for (let attempt = 0; ; attempt++) {
          try {
            await this.options.store.save(this.state)
            return
          } catch (error) {
            if (attempt >= 4) throw error
            await new Promise((done) => setTimeout(done, 100 * 2 ** attempt))
          }
        }
      })
    this.queued = next
    this.saving = next
    return next
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
    // The bars count the whole run: a second pass adds to what the first did
    // instead of starting from zero with a total of its own.
    this.moved = { download: { done: 0, bytes: 0 }, upload: { done: 0, bytes: 0 } }
    this.inRun = true
    try {
      return await this.passesUntilQuiet(total, maxPasses)
    } finally {
      this.inRun = false
    }
  }

  private async passesUntilQuiet(total: SyncReport, maxPasses: number): Promise<SyncReport> {
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
    // A pass on its own (sync(), not syncUntilQuiet()) counts from zero.
    if (!this.inRun) this.moved = { download: { done: 0, bytes: 0 }, upload: { done: 0, bytes: 0 } }
    this.carried = {
      download: { ...this.moved.download },
      upload: { ...this.moved.upload },
    }
    const state = await this.loadState()
    const report: SyncReport = { pulled: 0, pushed: 0, events: [], again: false }
    const disk = new Map((await this.options.files.list()).map((stat) => [stat.path, stat]))
    // A folder that lists empty while this device knows files in it is a folder
    // that is not there (a drive not mounted, a listing that failed), not a
    // vault somebody emptied. Going on would delete everything on the server.
    // A vault of a handful of files can still be emptied on purpose.
    if (disk.size === 0 && Object.keys(state.files).length > EMPTY_GUARD) {
      throw new Error('A pasta do vault apareceu vazia. O sync parou para não apagar nada.')
    }
    await this.pull(state, disk, report)
    await this.dedupe(state, report)
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

    const todo = [...latest.values()].filter((entry) => {
      const record = state.files[entry.fileId]
      return !record || entry.seq > record.seq
    })
    let done = 0
    for (const entry of todo) {
      const record = state.files[entry.fileId]
      await this.applyRemote(state, entry, record, disk, report)
      report.pulled++
      await this.saveState()
      this.progress({
        direction: 'download',
        done: ++done,
        total: todo.length,
        bytesDone: 0,
        bytesTotal: 0,
        path: state.files[entry.fileId]?.path ?? '',
      })
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
      // A copy of the same file under another id still stands for what is on
      // the disk: only the duplicate goes (see dedupe()).
      if (local?.status === 'clean' && !sharesPath(state, entry.fileId, record.path)) {
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
      if (
        meta.path !== record.path &&
        disk.has(record.path) &&
        local?.status === 'clean' &&
        !sharesPath(state, entry.fileId, record.path)
      ) {
        await files.remove(record.path)
        disk.delete(record.path)
      }
      await remember(meta.path, remoteBytes, stat)
      report.events.push({ kind: 'pulled', path: meta.path })
      return
    }
    record.seq = entry.seq
  }

  /* --------------------------------------------------------------- dedupe */

  /**
   * One path, one file. A push that failed halfway in versions before 0.15.0
   * left lanes sending after the pass ended, and the next pass sent the same
   * new files again under ids of their own: the server ended up with two or
   * three files at one path, all the same content. The copies are deleted on
   * the server, the first one sent stays, and the file on the disk is left
   * alone. Copies whose content differs are not touched here: the push sends
   * what is on the disk to each of them, and they are the same by the next pass.
   */
  private async dedupe(state: SyncState, report: SyncReport): Promise<void> {
    const byPath = new Map<string, [string, FileRecord][]>()
    for (const [id, record] of Object.entries(state.files)) {
      const group = byPath.get(record.path)
      if (group) group.push([id, record])
      else byPath.set(record.path, [[id, record]])
    }
    const copies: [string, FileRecord][] = []
    for (const group of byPath.values()) {
      if (group.length < 2) continue
      const hash = group[0]![1].hash
      if (!hash || group.some(([, record]) => record.hash !== hash)) continue
      group.sort(([, a], [, b]) => a.seq - b.seq)
      copies.push(...group.slice(1))
    }
    // A thousand copies one round trip at a time took minutes with nothing on
    // the screen: they go several at once, and the bar says what is going on.
    let removed = 0
    let refused = false
    await inParallel(copies, DELETES_AT_ONCE, async ([id, record]) => {
      if (refused) return
      const result = await this.options.remote.commit({
        fileId: id,
        parent: record.seq,
        meta: null,
        deleted: true,
      })
      if (!result.ok) {
        refused = true
        report.again = true
        return
      }
      delete state.files[id]
      await this.options.store.setBase(id, null)
      await this.saveState()
      removed++
      this.options.onProgress?.({
        direction: 'upload',
        label: 'Limpando cópias',
        done: removed,
        total: copies.length,
        bytesDone: 0,
        bytesTotal: 0,
        path: record.path,
      })
    })
    // Counted as sent: a pass that did something is followed by another.
    report.pushed += removed
  }

  /* ----------------------------------------------------------------- push */

  private async upload(
    path: string,
    bytes: Uint8Array,
    stat: LocalStat,
    hash: string,
  ): Promise<string> {
    const { crypto, remote } = this.options
    const pieces = chunk(bytes)
    const ids = pieces.map((piece) => crypto.chunkId(piece))
    const missing = new Set(await remote.missingChunks([...new Set(ids)]))
    const todo: number[] = []
    for (let i = 0; i < pieces.length; i++) {
      if (missing.delete(ids[i]!)) todo.push(i)
    }
    await inParallel(todo, CHUNKS_AT_ONCE, async (i) => {
      await remote.putChunk(ids[i]!, crypto.seal(pieces[i]!))
    })
    const meta: FileMeta = {
      path,
      size: bytes.length,
      mtime: stat.mtime,
      hash,
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

    // New files, and the ones among them that are a missing file moved. Only
    // their paths are kept: a first sync of a big vault would otherwise hold
    // every file in memory at once before sending the first. And only a file
    // the size of one that went missing can be that file moved, so only those
    // are read to compare.
    const created = [...disk.keys()].filter((path) => !tracked.has(path))
    const moves: [string, FileRecord, string, Uint8Array][] = []
    if (missing.length > 0) {
      const sizes = new Set(missing.map(([, record]) => record.size))
      for (const path of created.slice()) {
        if (!sizes.has(disk.get(path)!.size)) continue
        const bytes = await files.read(path)
        const hash = crypto.hash(bytes)
        const at = missing.findIndex(([, record]) => record.hash === hash)
        if (at < 0) continue
        const [id, record] = missing.splice(at, 1)[0]!
        created.splice(created.indexOf(path), 1)
        moves.push([id, record, path, bytes])
      }
    }

    // What this push has to send, for the progress bar.
    const sizeOf = (path: string) => disk.get(path)?.size ?? 0
    const upload = {
      done: 0,
      total: moves.length + changed.length + created.length,
      bytesDone: 0,
      bytesTotal:
        moves.reduce((n, [, , path]) => n + sizeOf(path), 0) +
        changed.reduce((n, [, record]) => n + sizeOf(record.path), 0) +
        created.reduce((n, path) => n + sizeOf(path), 0),
    }

    let refused = false
    const send = async (
      id: string,
      record: FileRecord | null,
      path: string,
      given: Uint8Array | null,
    ) => {
      if (refused) return false
      const stat = disk.get(path)!
      const bytes = given ?? (await files.read(path))
      const hash = crypto.hash(bytes)
      const meta = await this.upload(path, bytes, stat, hash)
      const result = await remote.commit({
        fileId: id,
        parent: record?.seq ?? null,
        meta,
        deleted: false,
      })
      if (!result.ok) {
        report.again = true
        refused = true
        return false
      }
      state.files[id] = {
        path,
        seq: result.seq,
        hash,
        size: stat.size,
        mtime: stat.mtime,
      }
      await store.setBase(id, isText(path) ? bytes : null)
      await this.saveState()
      report.pushed++
      report.events.push({ kind: 'pushed', path })
      upload.done++
      upload.bytesDone += stat.size
      this.progress({ direction: 'upload', ...upload, path })
      return true
    }

    for (const [id, record, path, bytes] of moves) {
      if (!(await send(id, record, path, bytes))) return
      report.events.push({ kind: 'moved', path, detail: record.path })
    }
    for (const [id, record, bytes] of changed)
      if (!(await send(id, record, record.path, bytes))) return
    // New files a few at a time: each one is a handful of round trips to the
    // server, and one after the other a vault of thousands took many minutes.
    await inParallel(created, FILES_AT_ONCE, async (path) => {
      await send(randomId(), null, path, null)
    })
    if (refused) return
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

/** Whether a file other than `id` is tracked at `path`. */
function sharesPath(state: SyncState, id: string, path: string): boolean {
  return Object.entries(state.files).some(([other, record]) => other !== id && record.path === path)
}

/** Past this many known files, a folder that lists empty stops the pass. */
const EMPTY_GUARD = 10
/** Repeated copies deleted at once: each is a single small request. */
const DELETES_AT_ONCE = 8
/** New files sent at once on a push. */
const FILES_AT_ONCE = 4
/** Chunks of one file sent at once. */
const CHUNKS_AT_ONCE = 4

/**
 * Runs `work` on every item, at most `limit` at a time, in order of start.
 * The first failure stops the lanes from taking more, and the call settles only
 * once the work already started has: lanes left running after the pass ended
 * would send files the next pass sends again, each under an id of its own.
 */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  let failure: { error: unknown } | null = null
  const lane = async () => {
    while (!failure && next < items.length) {
      try {
        await work(items[next++]!)
      } catch (error) {
        failure ??= { error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  if (failure) throw (failure as { error: unknown }).error
}
