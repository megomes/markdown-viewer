/**
 * What the screen knows about the sync: whether it is set up, running, failing,
 * and what it did lately. Kept apart from the engine so the app can show it
 * without loading libsodium and the engine until the sync actually starts.
 */

import { useSyncExternalStore } from 'react'
import type { SyncEvent } from '@markdown-viewer/sync/engine'
import { isDesktop } from '~/platform'

const CONFIG_KEY = 'markdown-viewer.sync'

export interface SyncConfig {
  server: string
  vault: string
  /** The open base that is synced. */
  baseId: string
  /** Its folder on disk. */
  folder: string
  deviceName: string
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

export interface SyncView {
  status: SyncStatus
  config: SyncConfig | null
  lastSync: number | null
  message: string | null
  /** The latest things that happened, newest first, for the panel. */
  events: (SyncEvent & { at: number })[]
}

export let view: SyncView = {
  status: 'off',
  config: loadConfig(),
  lastSync: null,
  message: null,
  events: [],
}
const listeners = new Set<() => void>()

export function set(patch: Partial<SyncView>): void {
  view = { ...view, ...patch }
  for (const listener of listeners) listener()
}

export function useSync(): SyncView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => view,
  )
}

function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? (JSON.parse(raw) as SyncConfig) : null
  } catch {
    return null
  }
}

export function saveConfig(config: SyncConfig | null): void {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    else localStorage.removeItem(CONFIG_KEY)
  } catch {
    // storage blocked
  }
  set({ config })
}

export function syncAvailable(): boolean {
  return isDesktop()
}
