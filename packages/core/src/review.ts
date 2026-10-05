/**
 * Review items in the Revisor Visual's format, read and written outside it.
 *
 * Inside the app the Revisor runs in the HTML page's isolated frame and keeps
 * its session in `localStorage`, under `rv_state`, which the app saves as
 * `.markdown-viewer/state/<caminho>.json`. Comments on Markdown notes are written
 * in the same shape, under the same key. So one reader serves both: the MCP,
 * the "copy for Claude" button and the comment list.
 *
 * `buildReviewExport` is the Revisor's own `buildExport` (shared.js, commit
 * 4168ef7), ported line for line: it is the text Claude already knows how to
 * follow. The one difference is that the vault path is passed in, because a
 * page inside the frame cannot know where it lives on disk.
 */

export interface ReviewItem {
  id: string
  n: number
  url?: string
  filePath?: string | null
  pageTitle?: string
  kind: string
  tagSig?: string
  inside?: string | null
  anchor: string
  anchorFrom?: string
  nearby?: { text: string; como: string } | null
  context?: string | null
  path?: string
  occurrences?: number
  comment: string
  createdAt?: string
  /** Written by Claude through the MCP: done, or a note on why not. */
  claude?: { status: 'applied' | 'declined'; note?: string; at: string }
  [key: string]: unknown
}

export interface ReviewState {
  items: ReviewItem[]
  nextN: number
  [key: string]: unknown
}

export const REVIEW_KEY = 'rv_state'

interface StateFile {
  version?: number
  localStorage?: Record<string, string>
}

/** The review session kept in a page's state file, or null when there is none. */
export function readReview(stateFileText: string): ReviewState | null {
  try {
    const file = JSON.parse(stateFileText) as StateFile
    const raw = file.localStorage?.[REVIEW_KEY]
    if (!raw) return null
    const state = JSON.parse(raw) as Partial<ReviewState>
    return {
      ...state,
      items: Array.isArray(state.items) ? state.items : [],
      nextN: state.nextN ?? 1,
    }
  } catch {
    return null
  }
}

/** The state file text with the review session replaced. */
export function writeReview(stateFileText: string | null, review: ReviewState): string {
  let file: StateFile = { version: 1, localStorage: {} }
  try {
    if (stateFileText) file = JSON.parse(stateFileText) as StateFile
  } catch {
    // start over
  }
  const storage = { ...file.localStorage, [REVIEW_KEY]: JSON.stringify(review) }
  return JSON.stringify({ version: 1, localStorage: storage }, null, 2) + '\n'
}

/** A new item for a comment on a note, in the Revisor's shape. */
export function noteItem(
  review: ReviewState | null,
  options: {
    title: string
    selected: string
    context: string | null
    section: string
    comment: string
  },
): ReviewState {
  const state: ReviewState = review ?? { items: [], nextN: 1 }
  const item: ReviewItem = {
    id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    n: state.nextN,
    url: '',
    filePath: null,
    pageTitle: options.title,
    kind: 'trecho de texto',
    tagSig: '<md>',
    inside: options.section || null,
    anchor:
      options.selected.length > 120 ? options.selected.slice(0, 117) + '...' : options.selected,
    anchorFrom: 'seleção',
    nearby: null,
    context: options.context,
    path: '',
    occurrences: 1,
    comment: options.comment,
    createdAt: new Date().toISOString(),
  }
  return { ...state, items: [...state.items, item], nextN: state.nextN + 1 }
}

const PREAMBLE_BASE =
  'Cada item traz uma âncora, que é o texto como ele aparece na página e, em geral,\n' +
  'literalmente no arquivo fonte, mais um caminho CSS que confirma o alvo. Ache o\n' +
  'trecho pela âncora, confirme pelo caminho e aplique o pedido. Não altere nada\n' +
  'fora do que está listado.'
const PREAMBLE_CTX = '\nNa linha Contexto, o que está entre « » é exatamente o trecho selecionado.'

function stamp(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The Revisor's "Copiar tudo" text. `pages` gives each page its file path and the
 * items still to do on it.
 */
export function buildReviewExport(
  pages: { filePath: string; title: string; items: ReviewItem[] }[],
  now = new Date(),
): string {
  const groups = pages
    .map((page) => ({ ...page, items: page.items.filter((i) => (i.comment || '').trim()) }))
    .filter((page) => page.items.length)
  const list = groups.flatMap((g) => g.items)
  if (!list.length) return ''
  const out: string[] = []
  const plural = list.length === 1 ? 'item' : 'itens'
  const pg = groups.length === 1 ? 'página' : 'páginas'
  out.push('# Revisão visual: ' + list.length + ' ' + plural + ' em ' + groups.length + ' ' + pg)
  out.push('Gerado em ' + stamp(now) + '.')
  out.push('')
  out.push(PREAMBLE_BASE + (list.some((i) => i.context) ? PREAMBLE_CTX : ''))
  out.push('')
  groups.forEach((g, gi) => {
    out.push('## Página ' + (gi + 1) + ': ' + g.title)
    out.push('Arquivo: ' + g.filePath)
    out.push('')
    for (const it of g.items) {
      let head = '### ' + it.n + ' · ' + it.kind + ' ' + (it.tagSig ?? '')
      if (it.inside) head += ' em ' + it.inside
      out.push(head)
      if (it.anchor) {
        out.push(
          'Âncora: "' +
            it.anchor +
            '"' +
            (it.anchorFrom && it.anchorFrom !== 'texto' && it.anchorFrom !== 'seleção'
              ? '  (vem de ' + it.anchorFrom + ')'
              : ''),
        )
      } else {
        out.push('Âncora: nenhuma, o elemento não tem texto próprio.')
        if (it.nearby) out.push('Perto de: "' + it.nearby.text + '" (' + it.nearby.como + ')')
      }
      if (it.context) out.push('Contexto: ' + it.context)
      if (it.path) out.push('Caminho: ' + it.path)
      if ((it.occurrences ?? 1) > 1) {
        out.push(
          'Atenção: esse texto aparece ' +
            it.occurrences +
            ' vezes na página. Desempate pelo caminho.',
        )
      }
      out.push('Pedido: ' + it.comment.trim().replace(/\n/g, '\n  '))
      out.push('')
    }
  })
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

/** Items Claude has not answered yet. */
export function pendingItems(review: ReviewState | null): ReviewItem[] {
  return (review?.items ?? []).filter((item) => (item.comment || '').trim() && !item.claude)
}

/** The source file a state file belongs to: `.markdown-viewer/state/a/b.html.json` is `a/b.html`. */
export function sourceOfState(statePath: string): string | null {
  const match = /^\.markdown-viewer\/state\/(.+)\.json$/.exec(statePath)
  return match ? match[1]! : null
}
