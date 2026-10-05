/**
 * The server's rules, in memory: what the Durable Object does, for tests and the
 * simulation. Kept to the same few rules so the two cannot drift far:
 * sequential numbers, a commit accepted only on top of the file's latest entry,
 * and chunks stored by id.
 */

import type { Commit, CommitResult, Remote, RemoteEntry } from './protocol'

export class MemoryServer {
  readonly log: RemoteEntry[] = []
  readonly heads = new Map<string, number>()
  readonly chunks = new Map<string, Uint8Array>()
  private clock = 0

  remote(device: string): Remote {
    return {
      changes: async (since) =>
        this.log.filter((entry) => entry.seq > since).map((e) => ({ ...e })),
      commit: async (commit) => this.commit(device, commit),
      missingChunks: async (ids) => ids.filter((id) => !this.chunks.has(id)),
      putChunk: async (id, sealed) => {
        this.chunks.set(id, sealed.slice())
      },
      getChunk: async (id) => {
        const chunk = this.chunks.get(id)
        if (!chunk) throw new Error('chunk ausente: ' + id)
        return chunk.slice()
      },
      history: async (fileId) => this.log.filter((entry) => entry.fileId === fileId),
    }
  }

  private commit(device: string, commit: Commit): CommitResult {
    const head = this.heads.get(commit.fileId) ?? null
    if (head !== commit.parent) return { ok: false, head }
    const seq = this.log.length + 1
    this.log.push({
      seq,
      fileId: commit.fileId,
      deleted: commit.deleted,
      meta: commit.meta,
      device,
      at: ++this.clock,
    })
    this.heads.set(commit.fileId, seq)
    return { ok: true, seq }
  }
}
