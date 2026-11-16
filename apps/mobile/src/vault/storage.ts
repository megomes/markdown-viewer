/**
 * Where the vault lives on the phone: a folder in the app's private storage,
 * with the mirror's state beside it, never inside it.
 */

import { Directory, File, Paths } from 'expo-file-system'
import type { LocalFiles, LocalStat } from '@markdown-viewer/sync/engine'
import type { MirrorState, MirrorStore } from '@markdown-viewer/sync/mirror'

export const vaultDir = new Directory(Paths.document, 'vault')
const stateFile = new File(Paths.document, 'mirror.json')
const basesDir = new Directory(Paths.document, 'bases')
const foldersFile = new File(Paths.document, 'folders.json')

function fileAt(path: string): File {
  return new File(vaultDir, ...path.split('/'))
}

function statOf(path: string, file: File): LocalStat {
  return { path, size: file.size, mtime: Math.floor(file.modificationTime ?? 0) }
}

/** The vault's folder, as the mirror sees it. Paths are vault paths, `/`-separated. */
export class PhoneFiles implements LocalFiles {
  async list(): Promise<LocalStat[]> {
    const out: LocalStat[] = []
    if (!vaultDir.exists) return out
    const walk = (dir: Directory, prefix: string) => {
      for (const item of dir.list()) {
        const path = prefix ? prefix + '/' + item.name : item.name
        if (item instanceof Directory) walk(item, path)
        else out.push(statOf(path, item))
      }
    }
    walk(vaultDir, '')
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    return fileAt(path).bytes()
  }

  async write(path: string, bytes: Uint8Array): Promise<LocalStat> {
    const file = fileAt(path)
    if (!file.parentDirectory.exists) file.parentDirectory.create({ intermediates: true })
    if (!file.exists) file.create()
    await file.write(bytes)
    return statOf(path, file)
  }

  async remove(path: string): Promise<void> {
    const file = fileAt(path)
    if (file.exists) file.delete()
  }

  async move(from: string, to: string): Promise<void> {
    const target = fileAt(to)
    if (!target.parentDirectory.exists) target.parentDirectory.create({ intermediates: true })
    await fileAt(from).move(target, { overwrite: true })
  }

  /** The file's address, for viewers that open it themselves. */
  uri(path: string): string {
    return fileAt(path).uri
  }
}

export class PhoneMirrorStore implements MirrorStore {
  async load(): Promise<MirrorState | null> {
    try {
      if (!stateFile.exists) return null
      const state = JSON.parse(await stateFile.text()) as MirrorState
      return state.version === 1 ? state : null
    } catch {
      return null
    }
  }

  async save(state: MirrorState): Promise<void> {
    // Written beside and then moved over, so a crash never leaves half a state.
    const next = new File(Paths.document, 'mirror.next.json')
    if (!next.exists) next.create()
    await next.write(JSON.stringify(state))
    await next.move(stateFile, { overwrite: true })
  }

  async getBase(fileId: string): Promise<Uint8Array | null> {
    const file = new File(basesDir, fileId)
    return file.exists ? file.bytes() : null
  }

  async setBase(fileId: string, bytes: Uint8Array | null): Promise<void> {
    const file = new File(basesDir, fileId)
    if (!bytes) {
      if (file.exists) file.delete()
      return
    }
    if (!basesDir.exists) basesDir.create({ intermediates: true })
    if (!file.exists) file.create()
    await file.write(bytes)
  }
}

/**
 * Folders made on this phone that have nothing in them yet. The vault's server
 * knows files, not folders, so an empty one exists only here until a note goes in.
 */
export async function loadEmptyFolders(): Promise<string[]> {
  try {
    if (!foldersFile.exists) return []
    const value = JSON.parse(await foldersFile.text()) as unknown
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

export async function saveEmptyFolders(folders: string[]): Promise<void> {
  if (!foldersFile.exists) foldersFile.create()
  await foldersFile.write(JSON.stringify(folders))
}

/** Forgets the vault on this phone: its copy and its state. */
export function wipeLocalVault(): void {
  if (vaultDir.exists) vaultDir.delete()
  if (stateFile.exists) stateFile.delete()
  if (basesDir.exists) basesDir.delete()
  if (foldersFile.exists) foldersFile.delete()
}
