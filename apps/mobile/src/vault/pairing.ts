/**
 * Joining the vault from the phone (docs/spec.md, sections 6.5 and 6.8).
 *
 * The desktop shows a QR with the server, the vault and a one-time code. The
 * code admits the device and unlocks the vault key, which then lives only in
 * the Android Keystore, through expo-secure-store.
 */

import * as SecureStore from 'expo-secure-store'
import * as Device from 'expo-device'
import { joinVault, type Connection } from '@markdown-viewer/sync/http-remote'

const CONNECTION = 'vault.connection'
const KEY = 'vault.key'

export interface Paired {
  connection: Connection
  key: Uint8Array
  deviceName: string
}

export interface PairingCode {
  server: string
  vault: string
  code: string
}

/** What the desktop's QR says, or null when the QR is something else. */
export function parsePairingQr(text: string): PairingCode | null {
  try {
    const value = JSON.parse(text) as Partial<PairingCode>
    if (
      typeof value.server === 'string' &&
      /^https?:\/\//.test(value.server) &&
      typeof value.vault === 'string' &&
      typeof value.code === 'string'
    ) {
      return { server: value.server.replace(/\/+$/, ''), vault: value.vault, code: value.code }
    }
  } catch {
    // not JSON
  }
  return null
}

export function defaultDeviceName(): string {
  return Device.deviceName || Device.modelName || 'Android'
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

export async function pair(code: PairingCode, deviceName: string): Promise<Paired> {
  const { connection, key } = await joinVault({
    server: code.server,
    vault: code.vault,
    secret: code.code,
    deviceName,
  })
  await SecureStore.setItemAsync(CONNECTION, JSON.stringify({ connection, deviceName }))
  await SecureStore.setItemAsync(KEY, toB64(key))
  return { connection, key, deviceName }
}

export async function loadPaired(): Promise<Paired | null> {
  const stored = await SecureStore.getItemAsync(CONNECTION)
  const key = await SecureStore.getItemAsync(KEY)
  if (!stored || !key) return null
  const { connection, deviceName } = JSON.parse(stored) as {
    connection: Connection
    deviceName: string
  }
  return { connection, key: fromB64(key), deviceName }
}

export async function forgetPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(CONNECTION)
  await SecureStore.deleteItemAsync(KEY)
}
