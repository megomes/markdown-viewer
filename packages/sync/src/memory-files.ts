/** A folder in memory, for the tests and the simulation. */

import type { LocalFiles, LocalStat, StateStore, SyncState } from './engine'

export class MemoryFiles implements LocalFiles {
  readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>()
  private clock = 0

  async list(): Promise<LocalStat[]> {
    return [...this.files].map(([path, f]) => ({ path, size: f.bytes.length, mtime: f.mtime }))
  }
  async read(path: string): Promise<Uint8Array> {
    const file = this.files.get(path)
    if (!file) throw new Error('não existe: ' + path)
    return file.bytes.slice()
  }
  async write(path: string, bytes: Uint8Array): Promise<LocalStat> {
    const mtime = ++this.clock
    this.files.set(path, { bytes: bytes.slice(), mtime })
    return { path, size: bytes.length, mtime }
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }
  async move(from: string, to: string): Promise<void> {
    const file = this.files.get(from)
    if (!file) throw new Error('não existe: ' + from)
    this.files.delete(from)
    this.files.set(to, file)
  }

  text(path: string): string | undefined {
    const file = this.files.get(path)
    return file ? new TextDecoder().decode(file.bytes) : undefined
  }
  async setText(path: string, text: string): Promise<void> {
    await this.write(path, new TextEncoder().encode(text))
  }
}

export class MemoryStore implements StateStore {
  state: SyncState | null = null
  readonly bases = new Map<string, Uint8Array>()
  async load() {
    return this.state ? (JSON.parse(JSON.stringify(this.state)) as SyncState) : null
  }
  async save(state: SyncState) {
    this.state = JSON.parse(JSON.stringify(state)) as SyncState
  }
  async getBase(id: string) {
    return this.bases.get(id) ?? null
  }
  async setBase(id: string, bytes: Uint8Array | null) {
    if (bytes) this.bases.set(id, bytes.slice())
    else this.bases.delete(id)
  }
}
