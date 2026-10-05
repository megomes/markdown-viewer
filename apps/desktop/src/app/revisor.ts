/**
 * Which Revisor Visual the HTML viewer runs, and fetching a newer one.
 *
 * The app carries a copy (`src/vendor/revisor`). "Atualizar Revisor" in the
 * settings fetches the latest release of github.com/megomes/revisor-visual (or
 * its main branch, while there is no release) and keeps it in the vault, at
 * `.markdown-viewer/revisor/revisor.json`: being a vault file, it reaches every
 * device through the sync, so one click updates them all.
 *
 * A version is only taken if it still keeps the contract this app relies on: it
 * runs without the extension, keeps its session in `localStorage` under
 * `rv_state`, exposes `window.__rv.setActive`, and takes the panel inside a frame
 * when `window.__rvEmbedded` says so. Otherwise the copy stays.
 */

import { encode } from '@markdown-viewer/core/text'
import { fileSystem } from '~/platform'
import vendoredShared from '~/vendor/revisor/shared.js?raw'
import vendoredContent from '~/vendor/revisor/content.js?raw'
import vendoredVersion from '~/vendor/revisor/VERSION?raw'

const REPO = 'megomes/revisor-visual'
const FILE = '.markdown-viewer/revisor/revisor.json'

export interface RevisorCode {
  version: string
  /** Where it came from: the copy in the app, or the one kept in the vault. */
  source: 'app' | 'vault'
  code: string
}

interface Stored {
  version: string
  shared: string
  content: string
  fetchedAt: string
}

/** Whether a pair of files still keeps the contract described above. */
export function keepsContract(shared: string, content: string): boolean {
  return (
    shared.includes('RVShared') &&
    content.includes("'rv_state'") &&
    content.includes('window.__rv.setActive') &&
    content.includes('__rvEmbedded') &&
    content.includes('hasExt')
  )
}

function combine(shared: string, content: string): string {
  return shared + '\n;\n' + content
}

const vendored: RevisorCode = {
  version: vendoredVersion.trim(),
  source: 'app',
  code: combine(vendoredShared, vendoredContent),
}

export async function revisorCode(baseId: string | null): Promise<RevisorCode> {
  if (!baseId) return vendored
  try {
    const { text } = await fileSystem().read(baseId, FILE)
    const stored = JSON.parse(text) as Stored
    if (keepsContract(stored.shared, stored.content)) {
      return {
        version: stored.version,
        source: 'vault',
        code: combine(stored.shared, stored.content),
      }
    }
  } catch {
    // nothing kept in the vault yet
  }
  return vendored
}

async function latestRef(): Promise<string> {
  const release = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  if (release.ok) return ((await release.json()) as { tag_name: string }).tag_name
  const commit = await fetch(`https://api.github.com/repos/${REPO}/commits/main`)
  if (!commit.ok) throw new Error('Não deu para falar com o GitHub.')
  return ((await commit.json()) as { sha: string }).sha.slice(0, 7)
}

async function raw(ref: string, file: string): Promise<string> {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${file}`)
  if (!response.ok) throw new Error(`Não achei ${file} na versão ${ref}.`)
  return response.text()
}

/** Fetches the newest Revisor into the vault. Hands back the version, or why not. */
export async function updateRevisor(
  baseId: string,
): Promise<{ ok: boolean; version: string; message: string }> {
  const ref = await latestRef()
  const [shared, content] = await Promise.all([raw(ref, 'shared.js'), raw(ref, 'content.js')])
  if (!keepsContract(shared, content)) {
    return {
      ok: false,
      version: ref,
      message: `A versão ${ref} mudou o jeito de embutir e não foi aceita. O app segue com a ${(await revisorCode(baseId)).version}.`,
    }
  }
  const stored: Stored = { version: ref, shared, content, fetchedAt: new Date().toISOString() }
  for (const folder of ['.markdown-viewer', '.markdown-viewer/revisor']) {
    try {
      if (!(await fileSystem().stat(baseId, folder)))
        await fileSystem().createFolder(baseId, folder)
    } catch {
      // already there
    }
  }
  await fileSystem().write(
    baseId,
    FILE,
    encode(JSON.stringify(stored), { eol: '\n', bom: false, encoding: 'utf-8', lossy: false }),
  )
  return { ok: true, version: ref, message: `Revisor atualizado para ${ref}.` }
}
