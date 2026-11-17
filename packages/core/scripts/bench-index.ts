/**
 * Mede o índice de links (base-index) num vault de verdade ou num sintético.
 *
 *   npm run bench:index -- "C:\Users\alex\Documents\Vault"
 *   npm run bench:index -- --synthetic 10000      gera um vault de 10 mil notas num temporário
 *
 * Conta também as chamadas ao sistema de arquivos, porque no desktop cada uma é
 * uma ida e volta entre a interface e o Rust, e é isso que pesa num vault grande.
 * Só lê; o sintético é escrito numa pasta temporária e apagado no fim.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIndex, type IndexSource, type IndexStats } from '../src/base-index'
import { entryId, type Entry } from '../src/fs'
import { decode } from '../src/text'

function source(root: string, calls: Record<string, number>): IndexSource {
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1)
  return {
    async list(baseId, path) {
      count('list')
      return readdirSync(join(root, path), { withFileTypes: true }).map((dirent): Entry => {
        const child = path ? path + '/' + dirent.name : dirent.name
        return {
          id: entryId(baseId, child),
          baseId,
          path: child,
          name: dirent.name,
          kind: dirent.isDirectory() ? 'directory' : 'file',
        }
      })
    },
    async stat(_, path) {
      count('stat')
      const stat = statSync(join(root, path))
      return { size: stat.size, modifiedAt: stat.mtimeMs }
    },
    async read(_, path) {
      count('read')
      const { text, shape } = decode(readFileSync(join(root, path)))
      return { text, shape, version: { size: 0, modifiedAt: 0 } }
    },
  } as IndexSource
}

function synthetic(count: number): string {
  const root = mkdtempSync(join(tmpdir(), 'mv-bench-'))
  const folders = 40
  for (let f = 0; f < folders; f++) mkdirSync(join(root, `Pasta ${f}`, 'Sub'), { recursive: true })
  for (let i = 0; i < count; i++) {
    const links = Array.from({ length: 6 }, (_, k) => `[[Nota ${(i * 7 + k * 131) % count}]]`).join(
      ' ',
    )
    // A few hubs that everybody points at, as a daily-notes index would be.
    const hub = `[[Nota ${i % 5}]]`
    const body =
      `---\ntags: [projeto, t${i % 30}]\naliases: [Apelido ${i}]\n---\n# Nota ${i}\n\n` +
      `Texto de exemplo ${'lorem ipsum '.repeat(40)}\n\n${links} ${hub}\n\n## Seção\n- [ ] tarefa\n`
    const folder = join(root, `Pasta ${i % folders}`, i % 3 === 0 ? 'Sub' : '')
    writeFileSync(join(folder, `Nota ${i}.md`), body)
  }
  return root
}

const args = process.argv.slice(2)
const synth = args.indexOf('--synthetic')
const root = synth >= 0 ? synthetic(Number(args[synth + 1] ?? 5000)) : args[0]
if (!root) {
  console.error('uso: bench:index -- <vault> | --synthetic <n>')
  process.exit(1)
}

try {
  // Twice: the first is the app opening the vault, the second is what each
  // rename, move or change seen on the disk costs afterwards.
  for (const run of ['abrir o vault', 'reindexar depois de uma mudança']) {
    const calls: Record<string, number> = {}
    let progress = 0
    let stats: IndexStats | null = null
    const index = await buildIndex(
      source(root, calls),
      'bench',
      () => progress++,
      () => false,
      (s) => (stats = s),
    )
    const backlinks = Object.values(index.backlinks).reduce((n, list) => n + list.length, 0)
    console.log(run, JSON.stringify({ backlinks, calls, progressCallbacks: progress, ...stats! }))
  }
} finally {
  if (synth >= 0) rmSync(root, { recursive: true, force: true })
}
