import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { handle, type Database, type Env, type Statement } from './index'

/**
 * D1 is SQLite, so the tests run the real migration and the real queries against
 * Node's own SQLite behind a thin adapter, batch as a transaction like D1's.
 */
function d1(db: DatabaseSync): Database {
  const statement = (sql: string, params: unknown[] = []): Statement & { exec(): unknown } => {
    const args = () => params as never[]
    const self = {
      bind: (...values: unknown[]) => statement(sql, values),
      all: async <T>() => ({ results: db.prepare(sql).all(...args()) as T[] }),
      first: async <T>() => (db.prepare(sql).get(...args()) as T | undefined) ?? null,
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args()).changes) } }),
      exec: () =>
        /\breturning\b/i.test(sql)
          ? { results: db.prepare(sql).all(...args()), meta: { changes: 1 } }
          : { meta: { changes: Number(db.prepare(sql).run(...args()).changes) } },
    }
    return self
  }
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec('begin')
      try {
        const out = statements.map((one) => (one as ReturnType<typeof statement>).exec())
        db.exec('commit')
        return out as { results?: unknown[]; meta: { changes: number } }[]
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
  }
}

const CODE = 'codigo-de-teste'
let sqlite: DatabaseSync
let env: Env

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  env = { DB: d1(sqlite), ACCESS_HASH: await hash(CODE) }
})

const call = async (method: string, path: string, payload?: unknown, token = CODE) => {
  const res = await handle(
    new Request('https://feedback.test' + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-device-id': 'mac-1' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    env,
  )
  return { status: res.status, data: (await res.json()) as Record<string, unknown> }
}

interface Listed {
  id: number
  body: string
  kind: string
  status: string
  appVersion: string | null
  screen: string | null
  resolution: Record<string, unknown>
  context: Record<string, unknown>
  log: { actor: string; action: string; message: string | null; detail: Record<string, unknown> }[]
}

const notes = async () => (await call('GET', '/feedback')).data.notes as Listed[]
const note = async (id: number) => (await notes()).find((one) => one.id === id)!
const claude = (id: number, status: string | null, message: string, resolution = '{}') =>
  sqlite
    .prepare('insert into note_claude (note_id, status, message, resolution) values (?, ?, ?, ?)')
    .run(id, status, message, resolution)

async function create(body = 'O botão some', kind = 'bug'): Promise<number> {
  const { data } = await call('POST', '/feedback', {
    body,
    kind,
    screen: 'editor:.md',
    clientId: 'c-1',
    context: { app: { version: '0.4.0', stage: 'etapa 2' } },
  })
  return data.id as number
}

describe('acesso', () => {
  it('recusa sem o código certo', async () => {
    expect((await call('GET', '/feedback', undefined, 'errado')).status).toBe(401)
  })

  it('responde ao preflight sem pedir o código', async () => {
    const res = await handle(
      new Request('https://feedback.test/feedback', { method: 'OPTIONS' }),
      env,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization')
  })
})

describe('criar e listar', () => {
  it('grava a nota com versão, tela, contexto do servidor e o evento no histórico', async () => {
    const id = await create()
    const n = await note(id)
    expect(n).toMatchObject({
      body: 'O botão some',
      kind: 'bug',
      status: 'open',
      appVersion: '0.4.0',
      screen: 'editor:.md',
    })
    expect(n.context.server).toBeDefined()
    expect(n.log).toEqual([
      expect.objectContaining({
        actor: 'user',
        action: 'created',
        detail: { kind: 'bug', client_id: 'c-1' },
      }),
    ])
  })

  it('recusa texto vazio e tipo desconhecido', async () => {
    expect((await call('POST', '/feedback', { body: '   ' })).status).toBe(400)
    expect((await call('POST', '/feedback', { body: 'x', kind: 'outro' })).status).toBe(400)
  })

  it('lista da mais nova para a mais antiga', async () => {
    const a = await create('a')
    const b = await create('b')
    expect((await notes()).map((one) => one.id)).toEqual([b, a])
  })
})

describe('editar e excluir', () => {
  it('edita enquanto aberta e guarda o texto anterior', async () => {
    const id = await create('antes', 'idea')
    expect((await call('PATCH', `/feedback/${id}`, { body: 'depois', kind: 'ux' })).status).toBe(
      200,
    )
    const n = await note(id)
    expect(n).toMatchObject({ body: 'depois', kind: 'ux' })
    expect(n.log.at(-1)).toMatchObject({
      action: 'edited',
      detail: { from: 'antes', to: 'depois', kind_from: 'idea', kind_to: 'ux' },
    })
  })

  it('não edita nem exclui depois que o Claude pegou', async () => {
    const id = await create()
    claude(id, 'in_progress', 'Começando')
    expect((await call('PATCH', `/feedback/${id}`, { body: 'x', kind: 'bug' })).status).toBe(409)
    expect((await call('DELETE', `/feedback/${id}`)).status).toBe(409)
  })

  it('exclui sem apagar, e o id nunca volta', async () => {
    const id = await create()
    expect((await call('DELETE', `/feedback/${id}`)).status).toBe(200)
    expect(await notes()).toEqual([])
    expect(await create()).toBe(id + 1)
    const log = sqlite.prepare('select action from note_log where note_id = ? order by id').all(id)
    expect(log.map((row) => row.action)).toEqual(['created', 'deleted'])
  })
})

describe('o Claude', () => {
  it('muda o status, mescla a resolução e grava no histórico numa instrução só', async () => {
    const id = await create()
    claude(id, 'in_progress', 'Começando')
    claude(id, null, 'Feito o passo X', '{"done":["a"]}')
    claude(
      id,
      'done',
      'Implementado',
      '{"summary":"Pronto","done":["a","b"],"commits":["abc1234"]}',
    )
    const n = await note(id)
    expect(n.status).toBe('done')
    expect(n.resolution).toEqual({ summary: 'Pronto', done: ['a', 'b'], commits: ['abc1234'] })
    expect(n.log.slice(1).map((l) => [l.actor, l.action, l.message])).toEqual([
      ['claude', 'status', 'Começando'],
      ['claude', 'work', 'Feito o passo X'],
      ['claude', 'status', 'Implementado'],
    ])
    expect(n.log[1]!.detail).toEqual({ status: 'in_progress' })
    expect(n.log[2]!.detail).toEqual({ resolution: { done: ['a'] } })
  })

  it('não mexe em nota que não existe, nem arquiva no lugar do Matheus', () => {
    expect(() => claude(999, 'done', 'x')).toThrow(/note not found/)
    return create().then((id) =>
      expect(() => claude(id, 'archived', 'x')).toThrow(/invalid status/),
    )
  })
})

describe('testar a entrega', () => {
  it('👍 arquiva, e só depois de entregue', async () => {
    const id = await create()
    expect((await call('PATCH', `/feedback/${id}`, { action: 'confirm' })).status).toBe(409)
    claude(id, 'done', 'Pronto')
    expect((await call('PATCH', `/feedback/${id}`, { action: 'confirm' })).status).toBe(200)
    const n = await note(id)
    expect(n.status).toBe('archived')
    expect(n.log.at(-1)).toMatchObject({
      actor: 'user',
      action: 'confirmed',
      detail: { from: 'done' },
    })
  })

  it('👎 exige comentário e reabre com ele', async () => {
    const id = await create()
    claude(id, 'ignored', 'Não vale')
    expect(
      (await call('PATCH', `/feedback/${id}`, { action: 'reject', comment: ' ' })).status,
    ).toBe(400)
    expect(
      (await call('PATCH', `/feedback/${id}`, { action: 'reject', comment: 'Ainda some' })).status,
    ).toBe(200)
    const n = await note(id)
    expect(n.status).toBe('open')
    expect(n.log.at(-1)).toMatchObject({
      action: 'rejected',
      message: 'Ainda some',
      detail: { from: 'ignored' },
    })
  })
})
