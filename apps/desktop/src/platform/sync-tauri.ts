/**
 * The sync engine's three ports on the desktop: the vault folder, the sync state
 * (in the app's data folder, never inside the vault) and the keychain.
 *
 * Unlike the tree, the sync sees dot folders: `.obsidian` and `.markdown-viewer`
 * travel too. Deleting goes to the system trash, as everywhere in this app.
 */

import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { mkdir, readFile, remove, rename, stat, writeFile } from './fs-plugin'
import type { LocalFiles, LocalStat, StateStore, SyncState } from '@markdown-viewer/sync/engine'
import { IGNORE_FILE, ignoreMatcher } from '@markdown-viewer/sync/ignore'

/** Never walked into: the ignore rules leave everything in them out anyway. */
export const SKIPPED_FOLDERS = ['.git', 'node_modules', '.trash']

function joinPath(root: string, path: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + separator + path.split('/').join(separator)
}

function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '')
}

export class TauriSyncFiles implements LocalFiles {
  constructor(private readonly root: string) {}

  async list(): Promise<LocalStat[]> {
    let extra = ''
    try {
      extra = new TextDecoder().decode(await readFile(joinPath(this.root, IGNORE_FILE)))
    } catch {
      // no ignore file
    }
    const ignored = ignoreMatcher(extra)
    // One native walk instead of a call per folder and per file (lib.rs).
    const files = await invoke<{ path: string; size: number; mtime: number }[]>('scan_tree', {
      root: this.root,
      skip: SKIPPED_FOLDERS,
    })
    return files.filter((file) => !ignored(file.path))
  }

  async read(path: string): Promise<Uint8Array> {
    return readFile(joinPath(this.root, path))
  }

  async write(path: string, bytes: Uint8Array): Promise<LocalStat> {
    const full = joinPath(this.root, path)
    await mkdir(parentOf(full), { recursive: true })
    await writeFile(full, bytes)
    const info = await stat(full)
    return { path, size: info.size, mtime: info.mtime ? info.mtime.getTime() : 0 }
  }

  async remove(path: string): Promise<void> {
    await invoke('move_to_trash', { path: joinPath(this.root, path) })
  }

  async move(from: string, to: string): Promise<void> {
    const target = joinPath(this.root, to)
    await mkdir(parentOf(target), { recursive: true })
    await rename(joinPath(this.root, from), target)
  }
}

/**
 * Opens the vault folder to the file plugin. The scope is not kept between runs:
 * a folder picked yesterday is out of reach today until it is allowed again.
 */
export async function allowFolder(folder: string): Promise<void> {
  await invoke('allow_base', { path: folder })
}

/** `<app data>/sync/<vault>/state.json` and `base/<file id>`. */
export async function stateFolder(vault: string): Promise<string> {
  // Rust creates it and opens it to the file plugin: the plugin's own mkdir is
  // not allowed in the app's data folder.
  return invoke<string>('sync_state_dir', { vault })
}

export class TauriStateStore implements StateStore {
  constructor(private readonly folder: string) {}

  async load(): Promise<SyncState | null> {
    try {
      return JSON.parse(
        new TextDecoder().decode(await readFile(joinPath(this.folder, 'state.json'))),
      ) as SyncState
    } catch {
      return null
    }
  }

  async save(state: SyncState): Promise<void> {
    const temp = joinPath(this.folder, 'state.json.tmp')
    await writeFile(temp, new TextEncoder().encode(JSON.stringify(state)))
    await rename(temp, joinPath(this.folder, 'state.json'))
  }

  async getBase(fileId: string): Promise<Uint8Array | null> {
    try {
      return await readFile(joinPath(this.folder, 'base/' + fileId))
    } catch {
      return null
    }
  }

  async setBase(fileId: string, bytes: Uint8Array | null): Promise<void> {
    const file = joinPath(this.folder, 'base/' + fileId)
    if (!bytes) {
      await remove(file).catch(() => {})
      return
    }
    await mkdir(parentOf(file), { recursive: true })
    await writeFile(file, bytes)
  }
}

export const secrets = {
  get: (name: string) => invoke<string | null>('secret_get', { name }),
  set: (name: string, value: string) => invoke<void>('secret_set', { name, value }),
  delete: (name: string) => invoke<void>('secret_delete', { name }),
}

/** The system's folder picker. The chosen folder is opened to the app's file access. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, multiple: false, title: 'Pasta do vault' })
  if (typeof picked !== 'string') return null
  await invoke('allow_base', { path: picked })
  return picked
}

/**
 * The setup code, read from `~/.markdown-viewer/sync-setup-code.txt` when this
 * machine has it (the one where the vault was set up). Null elsewhere.
 */
export async function readSetupCode(): Promise<string | null> {
  try {
    const { homeDir } = await import('@tauri-apps/api/path')
    const folder = await join(await homeDir(), '.markdown-viewer')
    await invoke('allow_base', { path: folder })
    const text = new TextDecoder().decode(await readFile(await join(folder, 'sync-setup-code.txt')))
    return text.trim() || null
  } catch {
    return null
  }
}
