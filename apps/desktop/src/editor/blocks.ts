/**
 * Blocks drawn in place of several lines: Mermaid diagrams, and the body of a
 * folded callout.
 *
 * A decoration that replaces line breaks has to come from a state field, not a
 * view plugin, which is why these live here and not in `seamless.ts`. The lines
 * are found by scanning the text, as `tables.ts` does, because the syntax tree
 * may not have reached the end of a long note yet.
 *
 * Both give the Markdown back when the cursor walks into them, like everything
 * else in the seamless editor.
 */

import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { activeLines, overlaps } from './active'
import { CALLOUT_HEAD } from './callouts'

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/

interface Span {
  from: number
  to: number
}

interface Found {
  mermaid: (Span & { code: string })[]
  /** Callouts written `[!tipo]-` or `[!tipo]+`, with the range of their body. */
  callouts: (Span & { head: number; collapsed: boolean })[]
}

function scan(state: EditorState): Found {
  const found: Found = { mermaid: [], callouts: [] }
  const lines: { text: string; from: number; to: number }[] = []
  let at = 0
  for (const text of state.doc.iterLines()) {
    lines.push({ text, from: at, to: at + text.length })
    at += text.length + 1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = FENCE.exec(line.text)
    if (fence) {
      let end = i + 1
      while (end < lines.length && !lines[end]!.text.trimStart().startsWith(fence[1]!)) end++
      if (fence[2]!.toLowerCase() === 'mermaid' && end < lines.length) {
        found.mermaid.push({
          from: line.from,
          to: lines[end]!.to,
          code: lines
            .slice(i + 1, end)
            .map((l) => l.text)
            .join('\n'),
        })
      }
      i = end
      continue
    }

    const head = CALLOUT_HEAD.exec(line.text)
    if (head && head[4]) {
      let end = i
      while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1]!.text)) end++
      if (end > i) {
        found.callouts.push({
          head: line.from,
          from: lines[i + 1]!.from,
          to: lines[end]!.to,
          collapsed: head[4] === '-',
        })
      }
    }
  }
  return found
}

/** Flips a foldable callout, by the position of its first line. */
export const toggleCallout = StateEffect.define<number>()

/** Callouts opened or closed by hand, against how they were written. */
const flipped = StateField.define<Set<number>>({
  create: () => new Set(),
  update(value, tr) {
    let next = value
    if (tr.docChanged && value.size) {
      next = new Set([...value].map((pos) => tr.changes.mapPos(pos)))
    }
    for (const effect of tr.effects) {
      if (!effect.is(toggleCallout)) continue
      next = new Set(next)
      if (next.has(effect.value)) next.delete(effect.value)
      else next.add(effect.value)
    }
    return next
  },
})

/** Whether a foldable callout is showing only its title right now. */
export function calloutFolded(
  state: EditorState,
  head: number,
  collapsedAsWritten: boolean,
): boolean {
  const flips = state.field(flipped, false)
  return flips?.has(head) ? !collapsedAsWritten : collapsedAsWritten
}

let mermaidLoad: Promise<typeof import('mermaid').default> | null = null
let mermaidCount = 0

function loadMermaid() {
  mermaidLoad ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark',
    })
    return mermaid
  })
  return mermaidLoad
}

class MermaidWidget extends WidgetType {
  constructor(private readonly code: string) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'cm-md-mermaid'
    box.textContent = 'Desenhando o diagrama…'
    void loadMermaid()
      .then((mermaid) => mermaid.render('mdv-mermaid-' + ++mermaidCount, this.code))
      .then(({ svg }) => {
        box.innerHTML = svg
        view.requestMeasure()
      })
      .catch((error: unknown) => {
        box.classList.add('is-error')
        box.textContent =
          'O diagrama não desenha: ' + (error instanceof Error ? error.message : String(error))
      })
    return box
  }

  ignoreEvent(): boolean {
    return false
  }
}

class FoldedWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const hidden = document.createElement('div')
    hidden.className = 'cm-md-callout-folded'
    return hidden
  }
}

function draw(state: EditorState, found: Found): DecorationSet {
  const spans = activeLines(state)
  const out: Range<Decoration>[] = []

  for (const block of found.mermaid) {
    if (overlaps(spans, block.from, block.to)) continue
    out.push(
      Decoration.replace({ block: true, widget: new MermaidWidget(block.code) }).range(
        block.from,
        block.to,
      ),
    )
  }
  for (const callout of found.callouts) {
    if (!calloutFolded(state, callout.head, callout.collapsed)) continue
    if (overlaps(spans, callout.from, callout.to)) continue
    out.push(
      Decoration.replace({ block: true, widget: new FoldedWidget() }).range(
        callout.from,
        callout.to,
      ),
    )
  }
  return Decoration.set(out, true)
}

interface BlockState {
  found: Found
  decorations: DecorationSet
}

const blocks = StateField.define<BlockState>({
  create(state) {
    const found = scan(state)
    return { found, decorations: draw(state, found) }
  },
  update(value, tr) {
    if (tr.docChanged) {
      const found = scan(tr.state)
      return { found, decorations: draw(tr.state, found) }
    }
    if (!tr.selection && tr.effects.length === 0) return value
    if (!value.found.mermaid.length && !value.found.callouts.length) return value
    return { found: value.found, decorations: draw(tr.state, value.found) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const blockWidgets = [flipped, blocks]
