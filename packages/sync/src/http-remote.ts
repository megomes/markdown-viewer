/**
 * The vault server over HTTP: the `Remote` the engine uses, plus creating a
 * vault, joining one and pairing a new device.
 */

import {
  createVaultKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  unwrapKey,
  wrapKey,
  type WrappedKey,
} from '@markdown-viewer/crypto/vault-crypto'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Commit, CommitResult, Remote, RemoteEntry } from './protocol'

/** The sync server (services/sync) has no default: each caller passes the one it deployed. */
export function requireServer(server: string | undefined): string {
  if (!server)
    throw new Error(
      'No sync server configured: set VITE_SYNC_SERVER (desktop) or MARKDOWN_VIEWER_SYNC_URL (scripts).',
    )
  return server.replace(/\/+$/, '')
}

export interface Connection {
  server: string
  vault: string
  token: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(
  conn: Omit<Connection, 'token'> & { token?: string },
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${conn.server}/v/${conn.vault}/${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof Uint8Array)
        ? { 'content-type': 'application/json' }
        : {}),
      ...(conn.token ? { authorization: `Bearer ${conn.token}` } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      message = ((await response.json()) as { error?: string }).error ?? message
    } catch {
      // not JSON
    }
    throw new HttpError(response.status, message)
  }
  return (await response.json()) as T
}

export function httpRemote(conn: Connection): Remote {
  return {
    async changes(since) {
      const all: RemoteEntry[] = []
      let from = since
      for (;;) {
        const page = await call<{ entries: RemoteEntry[]; more: boolean }>(
          conn,
          `changes?since=${from}`,
        )
        all.push(...page.entries)
        if (!page.more || !page.entries.length) return all
        from = page.entries[page.entries.length - 1]!.seq
      }
    },
    commit: (commit: Commit) =>
      call<CommitResult>(conn, 'commit', { method: 'POST', body: JSON.stringify(commit) }),
    async missingChunks(ids) {
      const missing: string[] = []
      for (let i = 0; i < ids.length; i += 1000) {
        const page = await call<{ missing: string[] }>(conn, 'chunks/missing', {
          method: 'POST',
          body: JSON.stringify({ ids: ids.slice(i, i + 1000) }),
        })
        missing.push(...page.missing)
      }
      return missing
    },
    async putChunk(id, sealed) {
      await call(conn, `chunks/${id}`, { method: 'PUT', body: sealed as BodyInit })
    },
    async getChunk(id) {
      const response = await fetch(`${conn.server}/v/${conn.vault}/chunks/${id}`, {
        headers: { authorization: `Bearer ${conn.token}` },
      })
      if (!response.ok) throw new HttpError(response.status, 'pedaço não encontrado: ' + id)
      return new Uint8Array(await response.arrayBuffer())
    },
    history: (fileId) => call<RemoteEntry[]>(conn, `history/${fileId}`),
  }
}

/** Wakes the device whenever the server accepts an entry. Returns a stop function. */
export function listen(
  conn: Connection,
  onEntry: (seq: number) => void,
  onDown?: () => void,
): () => void {
  let socket: WebSocket | null = null
  let stopped = false
  let retry = 1000
  const open = () => {
    if (stopped) return
    const url = `${conn.server.replace(/^http/, 'ws')}/v/${conn.vault}/ws?token=${encodeURIComponent(conn.token)}`
    socket = new WebSocket(url)
    socket.onopen = () => {
      retry = 1000
    }
    socket.onmessage = (event) => {
      try {
        const { seq } = JSON.parse(String(event.data)) as { seq: number }
        onEntry(seq)
      } catch {
        // ignore
      }
    }
    socket.onclose = () => {
      onDown?.()
      if (stopped) return
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 60_000)
    }
  }
  open()
  return () => {
    stopped = true
    socket?.close()
  }
}

interface Wrapped {
  password: WrappedKey
  recovery: WrappedKey
}

/** Creates the vault on the server. Hands back the key and the recovery code to keep. */
export async function createVault(options: {
  server: string
  vault: string
  setupCode: string
  password: string
  deviceName: string
}): Promise<{ connection: Connection; key: Uint8Array; recoveryCode: string }> {
  const key = await createVaultKey()
  const recoveryCode = await generateRecoveryCode()
  const wrapped: Wrapped = {
    password: await wrapKey(key, options.password),
    recovery: await wrapKey(key, recoveryCode),
  }
  const device = await call<{ id: string; token: string }>(options, 'setup', {
    method: 'POST',
    body: JSON.stringify({ setupCode: options.setupCode, wrapped, deviceName: options.deviceName }),
  })
  return {
    connection: { server: options.server, vault: options.vault, token: device.token },
    key,
    recoveryCode,
  }
}

/**
 * Joins with a pairing code (which also unlocks the key), or with the setup code
 * plus the vault password or the recovery code.
 */
export async function joinVault(options: {
  server: string
  vault: string
  secret: string
  deviceName: string
  password?: string
  recoveryCode?: string
}): Promise<{ connection: Connection; key: Uint8Array }> {
  const result = await call<{ token: string; wrapped: Wrapped; pairing: WrappedKey | null }>(
    options,
    'join',
    {
      method: 'POST',
      body: JSON.stringify({ secret: options.secret, deviceName: options.deviceName }),
    },
  )
  let key: Uint8Array
  if (result.pairing) key = await unwrapKey(result.pairing, normalizePairingCode(options.secret))
  else if (options.password) key = await unwrapKey(result.wrapped.password, options.password)
  else if (options.recoveryCode)
    key = await unwrapKey(result.wrapped.recovery, normalizeRecoveryCode(options.recoveryCode))
  else
    throw new Error(
      'Para entrar sem código de pareamento, informe a senha ou o código de recuperação.',
    )
  return { connection: { server: options.server, vault: options.vault, token: result.token }, key }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

/**
 * Whether a password or a recovery code really opens this vault, checked
 * against what the server holds: what is kept as a backup is only worth
 * something if it works on the day it is needed.
 */
export async function opensVault(
  conn: Connection,
  key: Uint8Array,
  kind: 'password' | 'recovery',
  secret: string,
): Promise<boolean> {
  const wrapped = await call<Wrapped | null>(conn, 'keys')
  if (!wrapped) throw new Error('O servidor não tem a chave deste vault.')
  try {
    const opened = await unwrapKey(
      wrapped[kind],
      kind === 'recovery' ? normalizeRecoveryCode(secret) : secret,
    )
    return sameBytes(opened, key)
  } catch {
    return false
  }
}

/**
 * Replaces the recovery code with a new one, from a device that holds the
 * vault key. The old code stops working; the password is not touched.
 */
export async function renewRecoveryCode(conn: Connection, key: Uint8Array): Promise<string> {
  const code = await generateRecoveryCode()
  const recovery = await wrapKey(key, code)
  // Never sent before it is seen to open the same key it was made from.
  if (!sameBytes(await unwrapKey(recovery, code), key))
    throw new Error('O código novo não abriu a chave. Nada foi trocado.')
  try {
    await call(conn, 'keys/recovery', { method: 'PUT', body: JSON.stringify(recovery) })
  } catch (error) {
    // A server older than this app answers that it does not know the route.
    if (error instanceof HttpError && error.status === 404)
      throw new Error(
        'O servidor de sync ainda é de uma versão anterior e não troca o código de recuperação. Nada mudou: o código antigo e a senha continuam valendo.',
      )
    throw error
  }
  if (!(await opensVault(conn, key, 'recovery', code)))
    throw new Error('O servidor não confirmou o código novo. Gere outro.')
  return code
}

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** In plain JavaScript: the phone's engine (Hermes) has no `crypto.subtle`. */
async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(sha256(new TextEncoder().encode(text)))
}

/**
 * Starts pairing a new device from this one: a one-time code, valid ten minutes,
 * that admits the device and hands it the vault key. Show it as text or QR.
 */
export async function startPairing(
  conn: Connection,
  key: Uint8Array,
): Promise<{ code: string; expires: number }> {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  const code = [...bytes].map((b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join('')
  const wrapped = await wrapKey(key, code)
  const { expires } = await call<{ expires: number }>(conn, 'pair', {
    method: 'POST',
    body: JSON.stringify({ codeHash: await sha256Hex(code), wrapped }),
  })
  return { code: code.match(/.{1,5}/g)!.join('-'), expires }
}

export async function listDevices(conn: Connection) {
  return call<
    { id: string; name: string; createdAt: number; lastSeen: number | null; revoked: number }[]
  >(conn, 'devices')
}

export async function revokeDevice(conn: Connection, id: string) {
  await call(conn, `devices/${id}`, { method: 'DELETE' })
}
