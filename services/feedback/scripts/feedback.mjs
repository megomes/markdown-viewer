#!/usr/bin/env node
/**
 * A fila de feedback do app, pelo lado do Claude.
 *
 *   npm run feedback -- list                 notas que não estão arquivadas
 *   npm run feedback -- list 2 3 4           só essas
 *   npm run feedback -- show 3               a nota, o contexto e o histórico inteiro
 *   npm run feedback -- 3 in_progress "Começando: …"
 *   npm run feedback -- 3 - "Feito o passo X"
 *   npm run feedback -- 3 done "Implementado e publicado" '{"summary":"…","done":["…"],"commits":["abc1234"],"deployed":"v0.5.0"}'
 *
 * Status aceitos: discussing, in_progress, done, ignored (ou "-" para não mudar).
 * A resolução é mesclada por chave: ao atualizar uma lista, mande a lista inteira.
 * Arquivar é só do Matheus, pelo 👍.
 *
 * Fala com o D1 de produção pelo wrangler, com o login da máquina.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATABASE = 'markdown-viewer-feedback'
const here = dirname(fileURLToPath(import.meta.url))
// The package does not export its bin, so it is found from the package's own folder.
const wranglerMain = createRequire(import.meta.url).resolve('wrangler')
const marker = `${sep}node_modules${sep}wrangler${sep}`
const wranglerRoot = wranglerMain.slice(0, wranglerMain.lastIndexOf(marker) + marker.length)
const wrangler = join(wranglerRoot, 'bin', 'wrangler.js')

function sql(command) {
  const run = spawnSync(
    process.execPath,
    [wrangler, 'd1', 'execute', DATABASE, '--remote', '--json', '--command', command],
    { cwd: dirname(here), encoding: 'utf8' },
  )
  if (run.status !== 0) {
    let message = run.stderr || run.stdout
    try {
      message = JSON.parse(run.stdout).error?.text ?? message
    } catch {
      // not JSON, keep what wrangler printed
    }
    console.error(message.trim())
    process.exit(1)
  }
  return JSON.parse(run.stdout)[0]?.results ?? []
}

const quote = (value) => (value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`)
const ids = (list) => {
  const numbers = list.map(Number)
  if (numbers.some((n) => !Number.isInteger(n) || n <= 0)) {
    console.error('ids precisam ser números inteiros')
    process.exit(1)
  }
  return numbers
}

const [first, ...rest] = process.argv.slice(2)

if (!first || first === 'list') {
  const filter = rest.length ? `id in (${ids(rest).join(', ')})` : `status <> 'archived'`
  const rows = sql(
    `select id, kind, status, body, resolution, created_at from notes
      where deleted = 0 and ${filter} order by id`,
  )
  for (const row of rows) {
    console.log(`#${row.id} · ${row.kind} · ${row.status} · ${row.created_at}`)
    console.log(row.body.replace(/^/gm, '  '))
    if (row.resolution !== '{}') console.log('  resolução: ' + row.resolution)
    console.log()
  }
  if (!rows.length) console.log('Nada na fila.')
} else if (first === 'show') {
  const [id] = ids(rest.slice(0, 1))
  const [row] = sql(`select * from notes where id = ${id} and deleted = 0`)
  if (!row) {
    console.error(`nota ${id} não encontrada`)
    process.exit(1)
  }
  const log = sql(
    `select ts, actor, action, message, detail from note_log where note_id = ${id} order by ts, id`,
  )
  console.log(
    JSON.stringify(
      {
        ...row,
        resolution: JSON.parse(row.resolution),
        context: JSON.parse(row.context),
        log: log.map((l) => ({ ...l, detail: JSON.parse(l.detail) })),
      },
      null,
      2,
    ),
  )
} else {
  const [id] = ids([first])
  const [status, message, resolution = '{}'] = rest
  if (!status || message === undefined) {
    console.error('uso: npm run feedback -- <id> <status ou -> "<mensagem>" [\'<resolução json>\']')
    process.exit(1)
  }
  try {
    const parsed = JSON.parse(resolution)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
  } catch {
    console.error('a resolução precisa ser um objeto JSON')
    process.exit(1)
  }
  sql(
    `insert into note_claude (note_id, status, message, resolution)
     values (${id}, ${status === '-' ? 'null' : quote(status)}, ${quote(message)}, ${quote(resolution)})`,
  )
  const [row] = sql(`select id, status from notes where id = ${id}`)
  console.log(`#${row.id} agora está ${row.status}.`)
}
