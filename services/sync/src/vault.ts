/**
 * One vault on the server: a Durable Object with its own SQLite.
 *
 * Being a single object is what keeps the log honest: commits from every device
 * arrive here one at a time, so two can never both think they are on top of the
 * same version. It also holds the open WebSockets, and tells each device the
 * moment a new entry lands.
 *
 * It never sees a path, a name or a byte of content: entries carry sealed
 * metadata, chunks are sealed before they leave the device, and the vault key
 * is stored only wrapped.
 */

import { DurableObject } from 'cloudflare:workers'

export interface Env {
  VAULT: DurableObjectNamespace<Vault>
  CHUNKS: R2Bucket
  /** SHA-256 hex of the setup code, which creates the vault and admits devices. */
  SETUP_HASH: string
}

const PAIR_TTL = 10 * 60_000
const MAX_PAIR_ATTEMPTS = 5

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function token(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

type DeviceRow = {
  id: string
  name: string
  revoked: number
} & Record<string, SqlStorageValue>

export class Vault extends DurableObject<Env> {
  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      create table if not exists meta (key text primary key, value text not null);
      create table if not exists devices (
        id text primary key, name text not null, token_hash text not null unique,
        created_at integer not null, last_seen integer, revoked integer not null default 0);
      create table if not exists log (
        seq integer primary key autoincrement, file_id text not null, deleted integer not null,
        meta text, device text not null, at integer not null);
      create index if not exists log_file on log (file_id, seq);
      create table if not exists heads (file_id text primary key, seq integer not null);
      create table if not exists chunks (id text primary key, size integer not null);
      create table if not exists pairings (
        code_hash text primary key, wrapped text not null, expires integer not null, attempts integer not null default 0);
    `)
  }

  private meta(key: string): string | null {
    const row = this.sql
      .exec<{ value: string }>('select value from meta where key = ?', key)
      .toArray()[0]
    return row?.value ?? null
  }

  private async device(req: Request): Promise<DeviceRow | null> {
    const header = req.headers.get('authorization') ?? ''
    const bearer = header.startsWith('Bearer ')
      ? header.slice(7)
      : new URL(req.url).searchParams.get('token')
    if (!bearer) return null
    const hash = await sha256(bearer)
    const row = this.sql
      .exec<DeviceRow>('select id, name, revoked from devices where token_hash = ?', hash)
      .toArray()[0]
    if (!row || row.revoked) return null
    this.sql.exec('update devices set last_seen = ? where id = ?', Date.now(), row.id)
    return row
  }

  private async register(name: string): Promise<{ id: string; token: string }> {
    const id = crypto.randomUUID()
    const secret = token()
    this.sql.exec(
      'insert into devices (id, name, token_hash, created_at) values (?, ?, ?, ?)',
      id,
      name.slice(0, 64),
      await sha256(secret),
      Date.now(),
    )
    return { id, token: secret }
  }

  private broadcast(message: unknown): void {
    const text = JSON.stringify(message)
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text)
      } catch {
        // a socket that went away is cleaned up by the runtime
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const [, , vault = '', action = '', ...rest] = url.pathname.split('/')
    const method = req.method

    // ---- unauthenticated: creating the vault and joining it ----
    if (action === 'setup' && method === 'POST') {
      const body = (await req.json()) as {
        setupCode?: string
        wrapped?: unknown
        deviceName?: string
      }
      if (!body.setupCode || !same(await sha256(body.setupCode), this.env.SETUP_HASH)) {
        return json({ error: 'código de configuração errado' }, 401)
      }
      if (this.meta('wrapped')) return json({ error: 'o vault já existe' }, 409)
      if (!body.wrapped || typeof body.wrapped !== 'object')
        return json({ error: 'faltou a chave' }, 400)
      this.sql.exec(
        'insert into meta (key, value) values (?, ?)',
        'wrapped',
        JSON.stringify(body.wrapped),
      )
      this.sql.exec('insert into meta (key, value) values (?, ?)', 'vault', vault)
      return json(await this.register(body.deviceName ?? 'primeiro aparelho'))
    }

    if (action === 'join' && method === 'POST') {
      const body = (await req.json()) as { secret?: string; deviceName?: string }
      const wrapped = this.meta('wrapped')
      if (!wrapped) return json({ error: 'esse vault não existe' }, 404)
      const secret = (body.secret ?? '').trim()
      let pairing: string | null = null
      if (secret && same(await sha256(secret), this.env.SETUP_HASH)) {
        // the setup code: the device still needs the password or recovery code
      } else {
        const code = secret.toUpperCase().replace(/[^A-Z0-9]/g, '')
        const hash = await sha256(code)
        const row = this.sql
          .exec<{ wrapped: string; expires: number; attempts: number }>(
            'select wrapped, expires, attempts from pairings where code_hash = ?',
            hash,
          )
          .toArray()[0]
        if (!row || row.expires < Date.now() || row.attempts >= MAX_PAIR_ATTEMPTS) {
          return json({ error: 'código inválido ou vencido' }, 401)
        }
        pairing = row.wrapped
        this.sql.exec('delete from pairings where code_hash = ?', hash)
      }
      const device = await this.register(body.deviceName ?? 'aparelho')
      return json({
        ...device,
        wrapped: JSON.parse(wrapped),
        pairing: pairing ? JSON.parse(pairing) : null,
      })
    }

    // ---- everything else needs a device ----
    const device = await this.device(req)
    if (!device) return json({ error: 'aparelho não autorizado' }, 401)

    if (action === 'ws') {
      if (req.headers.get('upgrade') !== 'websocket')
        return json({ error: 'esperava WebSocket' }, 426)
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    if (action === 'changes' && method === 'GET') {
      const since = Number(url.searchParams.get('since') ?? 0)
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 2000), 5000)
      const rows = this.sql
        .exec<{
          seq: number
          file_id: string
          deleted: number
          meta: string | null
          device: string
          at: number
        }>(
          'select seq, file_id, deleted, meta, device, at from log where seq > ? order by seq limit ?',
          since,
          limit,
        )
        .toArray()
      return json({
        entries: rows.map((r) => ({
          seq: r.seq,
          fileId: r.file_id,
          deleted: !!r.deleted,
          meta: r.meta,
          device: r.device,
          at: r.at,
        })),
        more: rows.length === limit,
      })
    }

    if (action === 'history' && method === 'GET' && rest[0]) {
      const rows = this.sql
        .exec<{
          seq: number
          file_id: string
          deleted: number
          meta: string | null
          device: string
          at: number
        }>(
          'select seq, file_id, deleted, meta, device, at from log where file_id = ? order by seq',
          rest[0],
        )
        .toArray()
      return json(
        rows.map((r) => ({
          seq: r.seq,
          fileId: r.file_id,
          deleted: !!r.deleted,
          meta: r.meta,
          device: r.device,
          at: r.at,
        })),
      )
    }

    if (action === 'commit' && method === 'POST') {
      const body = (await req.json()) as {
        fileId?: string
        parent?: number | null
        meta?: string | null
        deleted?: boolean
      }
      if (!body.fileId || typeof body.fileId !== 'string' || body.fileId.length > 64) {
        return json({ error: 'fileId inválido' }, 400)
      }
      if (!body.deleted && typeof body.meta !== 'string') return json({ error: 'faltou meta' }, 400)
      const head =
        this.sql
          .exec<{ seq: number }>('select seq from heads where file_id = ?', body.fileId)
          .toArray()[0]?.seq ?? null
      if (head !== (body.parent ?? null)) return json({ ok: false, head })
      const at = Date.now()
      this.sql.exec(
        'insert into log (file_id, deleted, meta, device, at) values (?, ?, ?, ?, ?)',
        body.fileId,
        body.deleted ? 1 : 0,
        body.deleted ? null : body.meta,
        device.id,
        at,
      )
      const seq = this.sql.exec<{ seq: number }>('select last_insert_rowid() as seq').toArray()[0]!
        .seq
      this.sql.exec(
        'insert into heads (file_id, seq) values (?, ?) on conflict(file_id) do update set seq = excluded.seq',
        body.fileId,
        seq,
      )
      this.broadcast({ seq, device: device.id })
      return json({ ok: true, seq })
    }

    if (action === 'chunks') {
      if (rest[0] === 'missing' && method === 'POST') {
        const { ids = [] } = (await req.json()) as { ids?: string[] }
        const wanted = ids.filter((id) => /^[0-9a-f]{64}$/.test(id)).slice(0, 1000)
        const have = new Set<string>()
        for (let i = 0; i < wanted.length; i += 90) {
          const slice = wanted.slice(i, i + 90)
          const rows = this.sql
            .exec<{ id: string }>(
              `select id from chunks where id in (${slice.map(() => '?').join(',')})`,
              ...slice,
            )
            .toArray()
          for (const row of rows) have.add(row.id)
        }
        return json({ missing: wanted.filter((id) => !have.has(id)) })
      }
      const id = rest[0] ?? ''
      if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: 'id inválido' }, 400)
      const key = `${vault}/${id}`
      if (method === 'PUT') {
        const body = await req.arrayBuffer()
        await this.env.CHUNKS.put(key, body)
        this.sql.exec('insert or ignore into chunks (id, size) values (?, ?)', id, body.byteLength)
        return json({ ok: true })
      }
      if (method === 'GET') {
        const object = await this.env.CHUNKS.get(key)
        if (!object) return json({ error: 'pedaço não encontrado' }, 404)
        return new Response(object.body, {
          headers: { 'content-type': 'application/octet-stream' },
        })
      }
    }

    if (action === 'pair' && method === 'POST') {
      // The pairing device makes up a code, wraps the vault key with it and sends
      // the wrapped key with the code's hash. The code itself never comes here.
      const { codeHash, wrapped } = (await req.json()) as { codeHash?: string; wrapped?: unknown }
      if (!wrapped || !codeHash || !/^[0-9a-f]{64}$/.test(codeHash))
        return json({ error: 'faltou a chave' }, 400)
      this.sql.exec('delete from pairings where expires < ?', Date.now())
      this.sql.exec(
        'insert into pairings (code_hash, wrapped, expires) values (?, ?, ?)',
        codeHash,
        JSON.stringify(wrapped),
        Date.now() + PAIR_TTL,
      )
      return json({ expires: Date.now() + PAIR_TTL })
    }

    if (action === 'devices') {
      if (method === 'GET') {
        return json(
          this.sql
            .exec(
              'select id, name, created_at as createdAt, last_seen as lastSeen, revoked from devices order by created_at',
            )
            .toArray(),
        )
      }
      if (method === 'DELETE' && rest[0]) {
        this.sql.exec('update devices set revoked = 1 where id = ?', rest[0])
        return json({ ok: true })
      }
    }

    if (action === 'keys' && method === 'GET') {
      return json(JSON.parse(this.meta('wrapped') ?? 'null'))
    }

    // A new recovery code, made on a device that already holds the vault key.
    // Only the recovery half changes: the password's stays as it is, so a
    // request gone wrong can never leave the vault with no way in.
    if (action === 'keys' && rest[0] === 'recovery' && method === 'PUT') {
      const current = JSON.parse(this.meta('wrapped') ?? 'null') as Record<string, unknown> | null
      if (!current) return json({ error: 'esse vault não existe' }, 404)
      const recovery = (await req.json()) as Record<string, unknown> | null
      const text = (value: unknown) => typeof value === 'string' && value.length > 0
      if (
        !recovery ||
        typeof recovery !== 'object' ||
        !text(recovery.alg) ||
        !text(recovery.salt) ||
        !text(recovery.nonce) ||
        !text(recovery.cipher)
      )
        return json({ error: 'chave embrulhada inválida' }, 400)
      this.sql.exec(
        "update meta set value = ? where key = 'wrapped'",
        JSON.stringify({ ...current, recovery }),
      )
      return json({ ok: true })
    }

    return json({ error: 'não encontrado' }, 404)
  }

  // Hibernating sockets: nothing to do on messages, the server only talks.
  async webSocketMessage(): Promise<void> {}
  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    socket.close(code, 'tchau')
  }
}
