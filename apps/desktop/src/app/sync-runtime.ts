/**
 * The sync engine as the app runs it, loaded only when the sync starts.
 *
 * What is configured (server, vault, folder, device name) lives in local
 * storage; the vault key and the device token live in the system keychain. The
 * controller runs a pass when the app starts, when the server says a device
 * committed something, a moment after files change in the folder, and once a
 * minute in case a signal was missed. Passes never overlap.
 */

import { VaultCrypto } from '@markdown-viewer/crypto/vault-crypto'
import { SyncEngine } from '@markdown-viewer/sync/engine'
import {
  createVault,
  DEFAULT_SERVER,
  httpRemote,
  joinVault,
  listDevices,
  listen,
  revokeDevice,
  startPairing,
  type Connection,
} from '@markdown-viewer/sync/http-remote'
import type { FileMeta, Remote, RemoteEntry } from '@markdown-viewer/sync/protocol'
import { fileSystem } from '~/platform'
import { saveConfig, set, syncAvailable, view, type SyncConfig } from './sync-state'
import { secrets, stateFolder, TauriStateStore, TauriSyncFiles } from '~/platform/sync-tauri'

const SECRET = (vault: string) => `sync:${vault}`
const PERIOD = 60_000
const LOCAL_DELAY = 2_000

interface Secret {
  token: string
  key: string // base64
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

interface Running {
  engine: SyncEngine
  remote: Remote
  connection: Connection
  key: Uint8Array
  crypto: VaultCrypto
  stops: (() => void)[]
}

let running: Running | null = null

async function runPass(): Promise<void> {
  if (!running) return
  set({ status: 'syncing', message: null })
  try {
    const report = await running.engine.syncUntilQuiet()
    const at = Date.now()
    const events = report.events.map((event) => ({ ...event, at }))
    set({
      status: 'idle',
      lastSync: at,
      events: [...events.reverse(), ...view.events].slice(0, 200),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    set({ status: navigator.onLine ? 'error' : 'offline', message })
  }
}

let localTimer: ReturnType<typeof setTimeout> | undefined

/** Asks for a pass soon: changes come in bursts, and one pass covers a burst. */
export function nudgeSync(delay = LOCAL_DELAY): void {
  if (!running) return
  clearTimeout(localTimer)
  localTimer = setTimeout(() => void runPass(), delay)
}

export async function startSync(): Promise<void> {
  const config = view.config
  if (!config || running || !syncAvailable()) return
  const stored = await secrets.get(SECRET(config.vault))
  if (!stored) {
    set({
      status: 'error',
      message: 'A chave deste aparelho sumiu do chaveiro. Entre de novo no vault.',
    })
    return
  }
  const secret = JSON.parse(stored) as Secret
  const key = fromBase64(secret.key)
  const crypto = await VaultCrypto.create(key)
  const connection: Connection = { server: config.server, vault: config.vault, token: secret.token }
  const remote = httpRemote(connection)
  const engine = new SyncEngine({
    files: new TauriSyncFiles(config.folder),
    store: new TauriStateStore(await stateFolder(config.vault)),
    remote,
    crypto,
    deviceName: config.deviceName,
  })
  const stops: (() => void)[] = []
  running = { engine, remote, connection, key, crypto, stops }

  stops.push(
    listen(
      connection,
      () => nudgeSync(300),
      () => set({ status: navigator.onLine ? view.status : 'offline' }),
    ),
  )
  const timer = setInterval(() => void runPass(), PERIOD)
  stops.push(() => clearInterval(timer))
  const watching = await fileSystem().watch(config.baseId, () => nudgeSync())
  if (watching) stops.push(watching)
  const online = () => nudgeSync(500)
  window.addEventListener('online', online)
  stops.push(() => window.removeEventListener('online', online))

  set({ status: 'idle' })
  await runPass()
}

export function stopSync(): void {
  for (const stop of running?.stops ?? []) stop()
  running = null
  clearTimeout(localTimer)
  set({ status: view.config ? 'idle' : 'off' })
}

export function syncNow(): Promise<void> {
  return runPass()
}

async function remember(
  config: SyncConfig,
  connection: Connection,
  key: Uint8Array,
): Promise<void> {
  await secrets.set(
    SECRET(config.vault),
    JSON.stringify({ token: connection.token, key: toBase64(key) } satisfies Secret),
  )
  saveConfig(config)
}

/** Creates the vault from this device. The recovery code must be shown once and kept. */
export async function setUpVault(options: {
  vault: string
  setupCode: string
  password: string
  deviceName: string
  baseId: string
  folder: string
  server?: string
}): Promise<string> {
  const server = options.server ?? DEFAULT_SERVER
  const { connection, key, recoveryCode } = await createVault({ ...options, server })
  await remember(
    {
      server,
      vault: options.vault,
      baseId: options.baseId,
      folder: options.folder,
      deviceName: options.deviceName,
    },
    connection,
    key,
  )
  return recoveryCode
}

export async function joinExistingVault(options: {
  vault: string
  secret: string
  password?: string
  recoveryCode?: string
  deviceName: string
  baseId: string
  folder: string
  server?: string
}): Promise<void> {
  const server = options.server ?? DEFAULT_SERVER
  const { connection, key } = await joinVault({ ...options, server })
  await remember(
    {
      server,
      vault: options.vault,
      baseId: options.baseId,
      folder: options.folder,
      deviceName: options.deviceName,
    },
    connection,
    key,
  )
}

/** Stops syncing on this device and forgets its key. The files stay. */
export async function leaveVault(): Promise<void> {
  const config = view.config
  stopSync()
  if (config) await secrets.delete(SECRET(config.vault)).catch(() => {})
  saveConfig(null)
  set({ status: 'off', events: [], lastSync: null })
}

export async function pairNewDevice(): Promise<{
  code: string
  expires: number
  vault: string
  server: string
}> {
  if (!running || !view.config) throw new Error('O sync não está ligado.')
  const { code, expires } = await startPairing(running.connection, running.key)
  return { code, expires, vault: view.config.vault, server: view.config.server }
}

export async function devices() {
  if (!running) return []
  return listDevices(running.connection)
}

export async function revoke(id: string) {
  if (running) await revokeDevice(running.connection, id)
}

export interface Version {
  seq: number
  at: number
  device: string
  deleted: boolean
  meta: FileMeta | null
}

/** Every version the server has of the file at this path. */
export async function versionsOf(path: string): Promise<Version[]> {
  if (!running || !view.config) return []
  const state = await new TauriStateStore(await stateFolder(view.config.vault)).load()
  const fileId = Object.entries(state?.files ?? {}).find(([, record]) => record.path === path)?.[0]
  if (!fileId) return []
  const entries: RemoteEntry[] = await running.remote.history(fileId)
  return entries
    .map((entry) => ({
      seq: entry.seq,
      at: entry.at,
      device: entry.device,
      deleted: entry.deleted,
      meta: entry.meta ? running!.crypto.openJson<FileMeta>(entry.meta) : null,
    }))
    .reverse()
}

/** Puts an old version back in place. The next pass sends it as the newest. */
export async function restoreVersion(version: Version): Promise<void> {
  if (!running || !view.config || !version.meta) return
  const remote = running.remote
  const parts: Uint8Array[] = []
  for (const id of version.meta.chunks) parts.push(running.crypto.open(await remote.getChunk(id)))
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.length
  }
  await new TauriSyncFiles(view.config.folder).write(version.meta.path, bytes)
  nudgeSync(200)
}
