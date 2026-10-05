/**
 * What travels between a device and the vault's server.
 *
 * The server keeps a log: each entry is one version of one file, numbered in the
 * order the server accepted it. It sees the file's stable id, the entry number,
 * which device sent it and whether it is a deletion. Everything else (path,
 * size, dates, hash, chunk list) is sealed metadata it cannot read.
 */

export interface RemoteEntry {
  seq: number
  fileId: string
  deleted: boolean
  /** Sealed `FileMeta`, absent on a deletion. */
  meta: string | null
  device: string
  /** When the server accepted it, ms. */
  at: number
}

/** The sealed part of an entry. */
export interface FileMeta {
  path: string
  size: number
  mtime: number
  /** Hash of the whole plaintext, to tell versions apart without downloading. */
  hash: string
  /** Chunk ids, in order. */
  chunks: string[]
}

export interface Commit {
  fileId: string
  /** The entry this version was made from; null for a new file. */
  parent: number | null
  meta: string | null
  deleted: boolean
}

export type CommitResult = { ok: true; seq: number } | { ok: false; head: number | null }

/** The vault server, as a device sees it. */
export interface Remote {
  /** Every entry after `since`, in order. */
  changes(since: number): Promise<RemoteEntry[]>
  /** Accepted only when `parent` is still the file's latest entry. */
  commit(commit: Commit): Promise<CommitResult>
  /** Which of these chunk ids the server does not have yet. */
  missingChunks(ids: string[]): Promise<string[]>
  putChunk(id: string, sealed: Uint8Array): Promise<void>
  getChunk(id: string): Promise<Uint8Array>
  /** Every version of one file, newest last. */
  history(fileId: string): Promise<RemoteEntry[]>
}
