/**
 * Feedback do app: a API da tela de Feedback.
 *
 * Espelho das rotas `/api/notes` do DailyFlow (commit 3fd41c3), com as mesmas regras:
 * id sequencial que nunca volta, exclusão lógica, editar e excluir só com a nota
 * aberta, confirmar e reabrir só depois de entregue, e cada mudança gravada no
 * histórico com o contexto de onde foi feita. O Claude não passa por aqui: ele
 * escreve direto no D1 pela tabela `note_claude` (ver migrations/0001_init.sql).
 */

/** The slice of D1 this Worker uses, so the tests can stand SQLite behind it. */
export interface Statement {
  bind(...values: unknown[]): Statement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ meta: { changes: number } }>
}
export interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<{ results?: unknown[]; meta: { changes: number } }[]>
}

export interface Env {
  DB: Database
  /** SHA-256, in hex, of the access code the app sends as a bearer token. */
  ACCESS_HASH: string
  VERSION?: { id?: string; tag?: string }
}

const KINDS = ['bug', 'idea', 'ux', 'question'] as const
type Kind = (typeof KINDS)[number]
const MAX_BODY = 5000
const MAX_CONTEXT = 16_000

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-device-id',
  'access-control-max-age': '86400',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  })
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compares in constant time, so the hash cannot be found a byte at a time. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function authorized(req: Request, env: Env): Promise<boolean> {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token || !env.ACCESS_HASH) return false
  return same(await sha256(token), env.ACCESS_HASH.toLowerCase())
}

interface Cf {
  country?: string
  region?: string
  city?: string
  colo?: string
}

/** Where the request came from, the counterpart of the original's Vercel headers. */
export function serverContext(req: Request, env: Env) {
  const cf = (req as Request & { cf?: Cf }).cf ?? {}
  return {
    userAgent: req.headers.get('user-agent') ?? undefined,
    country: cf.country,
    region: cf.region,
    city: cf.city,
    colo: cf.colo,
    build: env.VERSION?.tag || env.VERSION?.id?.slice(0, 8) || 'local',
    env: env.VERSION?.id ? 'production' : 'development',
    receivedAt: new Date().toISOString(),
  }
}

/** Client context is kept whole unless it is unreasonably large. */
function clampContext(ctx: unknown): Record<string, unknown> {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return {}
  return JSON.stringify(ctx).length > MAX_CONTEXT
    ? { truncated: true }
    : (ctx as Record<string, unknown>)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= MAX_BODY ? trimmed : null
}

function short(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

function isKind(value: unknown): value is Kind {
  return KINDS.includes(value as Kind)
}

async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

interface Row {
  id: number
  body: string
  kind: Kind
  status: string
  stage: string | null
  appVersion: string | null
  screen: string | null
  resolution: string
  context: string
  createdAt: string
  updatedAt: string
  log: string
}

/** Every note with its full history, newest first. */
async function list(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select n.id, n.body, n.kind, n.status, n.stage, n.app_version as appVersion, n.screen,
            n.resolution, n.context, n.created_at as createdAt, n.updated_at as updatedAt,
            (select json_group_array(json_object('ts', l.ts, 'actor', l.actor, 'action', l.action,
                                                 'message', l.message, 'detail', json(l.detail)))
               from (select * from note_log where note_id = n.id order by ts, id) l) as log
       from notes n where n.deleted = 0 order by n.id desc`,
  ).all<Row>()
  const notes = results.map((row) => ({
    ...row,
    resolution: JSON.parse(row.resolution) as unknown,
    context: JSON.parse(row.context) as unknown,
    log: JSON.parse(row.log ?? '[]') as unknown,
  }))
  return json({ notes })
}

/** Creates a note and logs it. */
async function create(req: Request, env: Env): Promise<Response> {
  const input = await body(req)
  const note = text(input?.body)
  const kind = input?.kind ?? 'idea'
  if (!input || !note || !isKind(kind)) return json({ error: 'invalid body' }, 400)
  const screen = input.screen === undefined ? null : short(input.screen, 64)
  const clientId = input.clientId === undefined ? null : short(input.clientId, 64)
  const client = clampContext(input.context)
  const context = { ...client, server: serverContext(req, env) }
  const app = (client.app ?? {}) as { version?: unknown; stage?: unknown }
  const device = req.headers.get('x-device-id')?.slice(0, 64) ?? null

  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `insert into notes (body, kind, stage, app_version, screen, device_id, context)
       values (?, ?, ?, ?, ?, ?, ?) returning id`,
    ).bind(
      note,
      kind,
      typeof app.stage === 'string' ? app.stage.slice(0, 64) : null,
      typeof app.version === 'string' ? app.version.slice(0, 64) : null,
      screen,
      device,
      JSON.stringify(context),
    ),
    env.DB.prepare(
      `insert into note_log (note_id, actor, action, detail)
       select id, 'user', 'created', json_object('kind', kind, 'client_id', ?)
         from notes where id = last_insert_rowid()`,
    ).bind(clientId),
  ])
  const created = inserted?.results?.[0] as { id: number } | undefined
  if (!created) return json({ error: 'not created' }, 500)
  return json({ id: created.id })
}

const TRANSITIONS = {
  confirm: { to: 'archived', log: 'confirmed' },
  reject: { to: 'open', log: 'rejected' },
  reopen: { to: 'open', log: 'reopened' },
} as const

/**
 * Edit text/kind (only while the note is open, previous values are logged) or move a
 * done/ignored note on: 👍 confirm archives it, 👎 reject reopens it with what is still
 * wrong. Returns 409 when the note is not in a state that allows the change.
 */
async function patch(req: Request, env: Env, id: number): Promise<Response> {
  const input = await body(req)
  if (!input) return json({ error: 'invalid' }, 400)
  const ctx = clampContext(input.context)
  const where = JSON.stringify({
    ...(JSON.stringify(ctx).length < MAX_CONTEXT ? ctx : {}),
    server: serverContext(req, env),
  })

  let statements: Statement[]
  if ('action' in input) {
    const action = input.action
    if (action !== 'confirm' && action !== 'reject' && action !== 'reopen') {
      return json({ error: 'invalid' }, 400)
    }
    const comment = action === 'reject' ? text(input.comment) : null
    if (action === 'reject' && !comment) return json({ error: 'invalid' }, 400)
    const transition = TRANSITIONS[action]
    const delivered = `id = ? and deleted = 0 and status in ('done', 'ignored')`
    statements = [
      env.DB.prepare(
        `insert into note_log (note_id, actor, action, message, detail)
         select id, 'user', ?, ?, json_object('from', status, 'context', json(?))
           from notes where ${delivered}`,
      ).bind(transition.log, comment, where, id),
      env.DB.prepare(
        `update notes set status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          where ${delivered}`,
      ).bind(transition.to, id),
    ]
  } else {
    const note = text(input.body)
    if (!note || !isKind(input.kind)) return json({ error: 'invalid' }, 400)
    const open = `id = ? and deleted = 0 and status = 'open'`
    statements = [
      env.DB.prepare(
        `insert into note_log (note_id, actor, action, detail)
         select id, 'user', 'edited',
                json_object('from', body, 'to', ?, 'kind_from', kind, 'kind_to', ?, 'context', json(?))
           from notes where ${open}`,
      ).bind(note, input.kind, where, id),
      env.DB.prepare(
        `update notes set body = ?, kind = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          where ${open}`,
      ).bind(note, input.kind, id),
    ]
  }
  const results = await env.DB.batch(statements)
  if (!results[1]?.meta.changes) return json({ error: 'locked' }, 409)
  return json({ ok: true })
}

/** Soft-deletes an open note (the id is never reused). */
async function remove(req: Request, env: Env, id: number): Promise<Response> {
  const open = `id = ? and deleted = 0 and status = 'open'`
  const results = await env.DB.batch([
    env.DB.prepare(
      `insert into note_log (note_id, actor, action, detail)
       select id, 'user', 'deleted', json_object('body', body, 'context', json(?))
         from notes where ${open}`,
    ).bind(JSON.stringify({ server: serverContext(req, env) }), id),
    env.DB.prepare(
      `update notes set deleted = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        where ${open}`,
    ).bind(id),
  ])
  if (!results[1]?.meta.changes) return json({ error: 'locked' }, 409)
  return json({ ok: true })
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(req.url)
  const match = /^\/feedback(?:\/(\d+))?\/?$/.exec(url.pathname)
  if (!match) return json({ error: 'not found' }, 404)
  if (!(await authorized(req, env))) return json({ error: 'unauthorized' }, 401)

  const id = match[1] ? Number(match[1]) : null
  if (id === null) {
    if (req.method === 'GET') return list(env)
    if (req.method === 'POST') return create(req, env)
    return json({ error: 'method not allowed' }, 405)
  }
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid' }, 400)
  if (req.method === 'PATCH') return patch(req, env, id)
  if (req.method === 'DELETE') return remove(req, env, id)
  return json({ error: 'method not allowed' }, 405)
}

export default { fetch: handle }
