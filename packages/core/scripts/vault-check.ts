/**
 * Percorre um vault e lista todo link, embed e alias que não resolve.
 *
 *   npm run vault:check -- "C:\Users\mathe\Documents\Obsidian Notes"
 *   npm run vault:check -- <vault> --json     a lista inteira, para comparar depois
 *
 * É o teste de aceite da seção 6.1 da spec: o que sair aqui tem que ser o que já
 * está quebrado no Obsidian. Só lê, nunca escreve no vault.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readNote, sameHeading, type LinkRef, type NoteInfo } from '../src/note'
import { createResolver } from '../src/resolver'

const IGNORED = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.markdown-viewer'])
const NOTE = /\.(md|markdown)$/i

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

interface Problem {
  file: string
  line: number
  kind: string
  link: string
  reason: string
}

export function checkVault(root: string): {
  files: number
  notes: number
  links: number
  problems: Problem[]
} {
  const paths = walk(root)
  const notes = new Map<string, { info: NoteInfo; text: string }>()
  for (const path of paths) {
    if (!NOTE.test(path)) continue
    if (statSync(join(root, path)).size > 4 * 1024 * 1024) continue
    const text = readFileSync(join(root, path), 'utf8')
    notes.set(path, { info: readNote(text), text })
  }

  const aliases: [string, string][] = []
  for (const [path, { info }] of notes)
    for (const alias of info.aliases) aliases.push([alias, path])
  const resolver = createResolver(paths, aliases)

  const problems: Problem[] = []
  let links = 0
  const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length

  for (const [path, { info, text }] of notes) {
    for (const link of info.links) {
      links++
      const report = (reason: string) =>
        problems.push({
          file: path,
          line: lineOf(text, link.from),
          kind: link.kind,
          link: text.slice(link.from, link.to),
          reason,
        })
      if (!link.target) {
        if (link.subpath) checkSubpath(link, info, report)
        continue
      }
      const resolved = resolver.resolve(link.target, path)
      if (!resolved) {
        report('arquivo não encontrado')
        continue
      }
      if (link.subpath) {
        const target = notes.get(resolved)
        if (target) checkSubpath(link, target.info, report)
      }
    }
  }

  return { files: paths.length, notes: notes.size, links, problems }
}

function checkSubpath(link: LinkRef, target: NoteInfo, report: (reason: string) => void): void {
  const sub = link.subpath!
  if (sub.startsWith('^')) {
    if (!target.blockIds.includes(sub.slice(1))) report('bloco não encontrado')
    return
  }
  // `#A#B` aponta para o título B dentro de A; basta o último existir.
  const last = sub.split('#').pop()!
  if (link.kind.startsWith('markdown') && !last.includes(' ')) {
    // Âncora de link Markdown vem com hífens no lugar de espaços.
    if (
      !target.headings.some(
        (h) => sameHeading(h.text, last.replaceAll('-', ' ')) || sameHeading(h.text, last),
      )
    ) {
      report('título não encontrado')
    }
    return
  }
  if (!target.headings.some((h) => sameHeading(h.text, last))) report('título não encontrado')
}

const [root, flag] = process.argv.slice(2)
if (root) {
  const result = checkVault(root)
  if (flag === '--json') {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`${result.files} arquivos, ${result.notes} notas, ${result.links} links e embeds.`)
    console.log(`${result.problems.length} não resolvem.\n`)
    const byReason = new Map<string, number>()
    for (const p of result.problems) byReason.set(p.reason, (byReason.get(p.reason) ?? 0) + 1)
    for (const [reason, count] of byReason) console.log(`  ${count} × ${reason}`)
    console.log()
    for (const p of result.problems) console.log(`${p.file}:${p.line}  ${p.link}  (${p.reason})`)
  }
}
