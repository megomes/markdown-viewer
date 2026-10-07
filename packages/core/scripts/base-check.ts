/**
 * Roda as Bases (`.base`) de um vault e mostra o que cada visão devolve, para
 * comparar com o Obsidian lado a lado. Só lê.
 *
 *   npm run base:check -- "C:\Users\alex\Documents\Vault"
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseBase, runView, showValue, type BaseFile } from '../src/bases'
import { readNote } from '../src/note'
import { createResolver } from '../src/resolver'

const IGNORED = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.markdown-viewer'])

function walk(root: string, dir = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue
    const path = dir ? dir + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...walk(root, path))
    else out.push(path)
  }
  return out
}

const root = process.argv[2]
if (!root) throw new Error('uso: base:check -- <vault>')
const paths = walk(root)
const notes = paths
  .filter((p) => /\.(md|markdown)$/i.test(p))
  .map((path) => ({ path, info: readNote(readFileSync(join(root, path), 'utf8')) }))
const resolver = createResolver(
  paths,
  notes.flatMap((n) => n.info.aliases.map((a) => [a, n.path] as [string, string])),
)
const files: BaseFile[] = notes.map(({ path, info }) => {
  const resolved = (kind: (k: string) => boolean) =>
    info.links
      .filter((l) => l.target && kind(l.kind))
      .map((l) => resolver.resolve(l.target, path))
      .filter((p): p is string => !!p)
  return {
    path,
    tags: info.tags,
    properties: info.properties,
    links: resolved(() => true),
    embeds: resolved((k) => k === 'embed' || k === 'markdown-image'),
    mtime: statSync(join(root, path)).mtimeMs,
  }
})

for (const basePath of paths.filter((p) => p.endsWith('.base'))) {
  const config = parseBase(readFileSync(join(root, basePath), 'utf8'))
  console.log(`\n=== ${basePath}`)
  config.views.forEach((view, i) => {
    const result = runView(config, i, files)
    console.log(`\n--- ${view.name} (${view.type}): ${result.total} itens`)
    if (result.errors.length) console.log('  erros:', result.errors)
    for (const group of result.groups) {
      if (view.groupBy) console.log(`  [${showValue(group.key) || '(vazio)'}] ${group.rows.length}`)
      for (const row of group.rows.slice(0, 4)) {
        const cells = result.columns.map((c) => showValue(row.values[c.key])).join(' | ')
        console.log(`    ${cells}${row.image ? '  🖼 ' + row.image : ''}`)
      }
      if (group.rows.length > 4) console.log(`    … mais ${group.rows.length - 4}`)
    }
  })
}
