/**
 * A folder and its sync state on a machine with Node: the command-line device
 * (`scripts/device.ts`) and the tests against the real server.
 *
 * The state lives outside the folder, so it never syncs itself. A deleted file
 * is moved to the state's own trash, never removed for good.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LocalFiles, LocalStat, StateStore, SyncState } from './engine'
import { IGNORE_FILE, ignoreMatcher } from './ignore'

export class NodeFiles implements LocalFiles {
  constructor(
    readonly root: string,
    private readonly trash: string,
  ) {}

  private full(path: string): string {
    return join(this.root, ...path.split('/'))
  }

  async list(): Promise<LocalStat[]> {
    let extra = ''
    try {
      extra = await readFile(this.full(IGNORE_FILE), 'utf8')
    } catch {
      // no ignore file
    }
    const ignored = ignoreMatcher(extra)
    const out: LocalStat[] = []
    const walk = async (dir: string) => {
      for (const entry of await readdir(this.full(dir), { withFileTypes: true })) {
        const path = dir ? dir + '/' + entry.name : entry.name
        if (ignored(path) || ignored(path + '/')) continue
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) {
          const info = await stat(this.full(path))
          out.push({ path, size: info.size, mtime: Math.floor(info.mtimeMs) })
        }
      }
    }
    await walk('')
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.full(path)))
  }

  async write(path: string, bytes: Uint8Array): Promise<LocalStat> {
    const full = this.full(path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, bytes)
    const info = await stat(full)
    return { path, size: info.size, mtime: Math.floor(info.mtimeMs) }
  }

  async remove(path: string): Promise<void> {
    const target = join(this.trash, `${Date.now()}`, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await rename(this.full(path), target)
  }

  async move(from: string, to: string): Promise<void> {
    await mkdir(dirname(this.full(to)), { recursive: true })
    await rename(this.full(from), this.full(to))
  }
}

export class FileStore implements StateStore {
  constructor(private readonly dir: string) {}

  async load(): Promise<SyncState | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, 'state.json'), 'utf8')) as SyncState
    } catch {
      return null
    }
  }

  async save(state: SyncState): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const temp = join(this.dir, 'state.json.tmp')
    await writeFile(temp, JSON.stringify(state))
    await rename(temp, join(this.dir, 'state.json'))
  }

  async getBase(fileId: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.dir, 'base', fileId)))
    } catch {
      return null
    }
  }

  async setBase(fileId: string, bytes: Uint8Array | null): Promise<void> {
    const file = join(this.dir, 'base', fileId)
    if (!bytes) {
      await rm(file, { force: true })
      return
    }
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, bytes)
  }
}
