/**
 * Links in the editor: which file each one leads to, what happens on a click,
 * and how a link to nothing looks.
 *
 * Resolution lives in `@markdown-viewer/core/resolver`, built from the base's
 * index. This module only keeps the resolver of each base where the editor can
 * reach it, and the function the app gave for opening a file. Both are set from
 * outside, by the app, which is the one that knows about tabs.
 */

import { syntaxTree } from '@codemirror/language'
import { StateEffect, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { Resolver } from '@markdown-viewer/core/resolver'
import { activeLines, overlaps } from './active'
import { documentSource } from './images'

const resolvers = new Map<string, Resolver>()

export interface LinkTarget {
  baseId: string
  path: string
  /** `Título` or `^bloco`, from `#…` in the link. */
  subpath: string | null
}

type Opener = (target: LinkTarget, inNewTab: boolean) => void
let opener: Opener | null = null

/** Raised whenever a base's resolver changes, so link styles are redrawn. */
export const linksChanged = StateEffect.define<null>()

let generation = 0

/**
 * Goes up every time a resolver changes. Widgets that resolved a file keep the
 * number they saw, and redraw when it moves, so an image that was looked up
 * before the index existed is looked up again.
 */
export function resolverGeneration(): number {
  return generation
}

export function setVaultResolver(baseId: string, resolver: Resolver | null): void {
  if ((resolvers.get(baseId) ?? null) === resolver) return
  generation++
  if (resolver) resolvers.set(baseId, resolver)
  else resolvers.delete(baseId)
}

export function setLinkOpener(open: Opener | null): void {
  opener = open
}

/**
 * The vault path a link leads to. Undefined while the base is still being read,
 * which is different from null, a link that leads nowhere.
 */
export function resolveLink(
  baseId: string,
  target: string,
  from: string,
): string | null | undefined {
  const resolver = resolvers.get(baseId)
  if (!resolver) return undefined
  return resolver.resolve(target, from)
}

/** `alvo#sub|texto` split into its parts. */
export function splitLink(inner: string): { target: string; subpath: string | null } {
  const bar = inner.indexOf('|')
  const path = bar < 0 ? inner : inner.slice(0, bar)
  const hash = path.indexOf('#')
  return {
    target: (hash < 0 ? path : path.slice(0, hash)).trim(),
    subpath: hash < 0 ? null : path.slice(hash + 1).trim() || null,
  }
}

function isRemote(url: string): boolean {
  return /^[a-z][\w+.-]*:/i.test(url)
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

interface Found {
  /** A wiki link or a Markdown link to a local file. */
  kind: 'wiki' | 'markdown' | 'remote'
  target: string
  subpath: string | null
  from: number
  to: number
}

/** The link under a position in the document, if there is one. */
export function linkAt(view: EditorView, pos: number): Found | null {
  let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(
    view.state,
  ).resolveInner(pos, 1)
  while (node && node.name !== 'Wikilink' && node.name !== 'Link') node = node.parent
  if (!node) return null
  const text = view.state.doc.sliceString(node.from, node.to)

  if (node.name === 'Wikilink') {
    const { target, subpath } = splitLink(text.slice(2, -2))
    return { kind: 'wiki', target, subpath, from: node.from, to: node.to }
  }

  const url = node.getChild('URL')
  if (!url) return null
  let raw = view.state.doc.sliceString(url.from, url.to)
  if (raw.startsWith('<')) raw = raw.slice(1, -1)
  if (isRemote(raw))
    return { kind: 'remote', target: raw, subpath: null, from: node.from, to: node.to }
  const hash = raw.indexOf('#')
  return {
    kind: 'markdown',
    target: safeDecode(hash < 0 ? raw : raw.slice(0, hash)),
    subpath: hash < 0 ? null : safeDecode(raw.slice(hash + 1)) || null,
    from: node.from,
    to: node.to,
  }
}

/** Follows the link: in the app, a note or file; outside, the system browser. */
export function followLink(view: EditorView, link: Found, inNewTab: boolean): boolean {
  const source = view.state.facet(documentSource)
  if (link.kind === 'remote') {
    void import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(link.target))
      .catch(() => window.open(link.target, '_blank', 'noopener'))
    return true
  }
  if (!source || !opener) return false
  const path = link.target ? resolveLink(source.baseId, link.target, source.path) : source.path
  if (!path) return false
  opener({ baseId: source.baseId, path, subpath: link.subpath }, inNewTab)
  return true
}

const missing = Decoration.mark({ class: 'cm-md-link-missing' })

function build(view: EditorView): DecorationSet {
  const source = view.state.facet(documentSource)
  if (!source || !resolvers.has(source.baseId)) return Decoration.none
  const out: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Wikilink') return
        const { target } = splitLink(view.state.doc.sliceString(node.from + 2, node.to - 2))
        if (target && resolveLink(source.baseId, target, source.path) === null) {
          out.push(missing.range(node.from, node.to))
        }
        return false
      },
    })
  }
  return Decoration.set(out, true)
}

/** Paints links that lead nowhere, the way Obsidian dims an unresolved link. */
export const linkStyles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate): void {
      const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(linksChanged)))
      if (update.docChanged || update.viewportChanged || refreshed)
        this.decorations = build(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/**
 * A click on a link outside the line being edited follows it, as in Obsidian's
 * live preview. On the line being edited the click places the cursor, and
 * Cmd or Ctrl follows it from anywhere. Cmd or Ctrl with Shift opens it in a
 * tab of its own.
 */
export const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false
    const link = linkAt(view, pos)
    if (!link) return false
    const mod = event.metaKey || event.ctrlKey
    const onActiveLine = overlaps(activeLines(view.state), link.from, link.to)
    if (!mod && onActiveLine) return false
    if (!followLink(view, link, mod && event.shiftKey)) return false
    event.preventDefault()
    return true
  },
})

/** Opens a file the app knows by base and path, as a click on a link would. */
export function openTarget(target: LinkTarget, inNewTab = false): void {
  opener?.(target, inNewTab)
}
