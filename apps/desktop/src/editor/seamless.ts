/**
 * Seamless Markdown: the syntax is hidden until the cursor enters its line.
 *
 * The document on disk is never touched. Everything here is decoration over the
 * plain Markdown text, which is what keeps select-all-and-copy giving Markdown
 * back instead of rendered text.
 *
 * Two things keep typing fast:
 * decorations are built only for the visible ranges, so typing in a large file
 * does not rebuild the whole document, and the set is rebuilt on a cursor move
 * only when the move changed which lines are active, so dragging a selection
 * inside one line does not flicker.
 */

import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'
import { activeLines, overlaps, sameLines, type LineSpan } from './active'
import { CalloutIconWidget, parseCallout } from './callouts'
import { findFrontmatter } from './frontmatter'
import { documentSource, ImageWidget, isImagePath, parseImage } from './images'
import { BulletWidget, RuleWidget, TaskWidget } from './widgets'
import { calloutFolded, toggleCallout } from './blocks'
import { FileCardWidget, NoteEmbedWidget } from './embeds'
import { linksChanged, resolveLink, splitLink } from './links'

/** The chevron on a foldable callout, which folds and unfolds it. */
class FoldWidget extends WidgetType {
  constructor(
    private readonly head: number,
    private readonly folded: boolean,
  ) {
    super()
  }
  eq(other: FoldWidget): boolean {
    return other.head === this.head && other.folded === this.folded
  }
  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('span')
    button.className = 'cm-md-callout-fold' + (this.folded ? ' is-folded' : '')
    button.setAttribute('role', 'button')
    button.title = this.folded ? 'Mostrar o conteúdo' : 'Recolher'
    button.textContent = '›'
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({ effects: toggleCallout.of(this.head) })
    })
    return button
  }
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * The top right corner of a code block: the language, and a button that copies
 * the code (without the fences). It stands in for the opening fence while the
 * cursor is outside the block, and sits beside it while the block is edited.
 */
class CodeHeaderWidget extends WidgetType {
  constructor(
    private readonly language: string,
    private readonly code: string,
  ) {
    super()
  }
  eq(other: CodeHeaderWidget): boolean {
    return other.language === this.language && other.code === this.code
  }
  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-md-code-header'
    if (this.language) {
      const label = document.createElement('span')
      label.className = 'cm-md-code-language'
      label.textContent = this.language
      box.append(label)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cm-md-code-copy'
    button.title = 'Copiar o código'
    button.setAttribute('aria-label', 'Copiar o código')
    button.innerHTML = COPY_ICON
    // Pressing the button never moves the cursor into the block.
    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void navigator.clipboard.writeText(this.code).then(
        () => {
          button.innerHTML = CHECK_ICON
          button.title = 'Copiado'
          button.classList.add('is-done')
          setTimeout(() => {
            button.innerHTML = COPY_ICON
            button.title = 'Copiar o código'
            button.classList.remove('is-done')
          }, 1500)
        },
        () => {
          button.title = 'Não deu para copiar'
        },
      )
    })
    box.append(button)
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Lucide's `copy` and `check`, drawn in the text colour. */
const ICON = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const COPY_ICON = ICON(
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
)
const CHECK_ICON = ICON('<path d="M20 6 9 17l-5-5"/>')

const FENCE = /^\s*(`{3,}|~{3,})/

/** `%% comentário %%` on one line, and the `^id` that names a block. */
const COMMENT = /%%[^%\n]*?%%/g
const BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/

const hidden = Decoration.replace({})

const headingLine = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: 'cm-md-heading cm-md-h' + level }),
)

/**
 * Line decorations are compared by their class, so handing CodeMirror the same
 * object every time spares it work on every keystroke.
 */
const lineCache = new Map<string, Decoration>()

function lineDecoration(classes: string): Decoration {
  let decoration = lineCache.get(classes)
  if (!decoration) {
    decoration = Decoration.line({ class: classes })
    lineCache.set(classes, decoration)
  }
  return decoration
}

/** Inline marks that vanish when the cursor is elsewhere. */
const INLINE_MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'HighlightMark',
  'LinkMark',
  'WikilinkMark',
  'WikilinkPath',
  'URL',
  'LinkTitle',
])

function headingLevel(name: string): number {
  return name.startsWith('ATXHeading') ? Number(name.slice('ATXHeading'.length)) : 0
}

function hasAncestor(node: { node: { parent: unknown } }, name: string): boolean {
  let parent = node.node.parent as { name: string; parent: unknown } | null
  while (parent) {
    if (parent.name === name) return true
    parent = parent.parent as { name: string; parent: unknown } | null
  }
  return false
}

/**
 * A line decoration for every line the block covers, with the first and the
 * last marked so that only the outer corners of the block round off.
 */
function decorateBlock(
  state: EditorState,
  block: { from: number; to: number },
  view: { from: number; to: number },
  base: string,
  out: Range<Decoration>[],
): void {
  // A block can run far past the screen in both directions. Only the lines on
  // screen are worth a decoration, and the ends are still read from the real
  // bounds of the block so the corners round off in the right places.
  let pos = Math.max(block.from, state.doc.lineAt(Math.max(view.from, block.from)).from)
  const stop = Math.min(block.to, view.to)

  while (pos <= stop) {
    const line = state.doc.lineAt(pos)
    const head = line.from <= block.from
    const tail = line.to >= block.to
    const classes = base + (head ? ' is-first' : '') + (tail ? ' is-last' : '')
    out.push(lineDecoration(classes).range(line.from))
    if (line.to >= stop) break
    pos = line.to + 1
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const spans = activeLines(state)
  const out: Range<Decoration>[] = []

  // The front matter block itself is drawn by `frontmatterBlock`. Here it only
  // has to be left alone: a replaced range may not contain another one, and the
  // raw YAML is what the person should see once the block is open.
  const matter = findFrontmatter(state)
  const source = state.facet(documentSource)
  // A block that spans two visible ranges is entered once for each. Its line
  // decorations repeat harmlessly, but its widgets would be drawn twice.
  const drawn = new Set<number>()

  for (const visible of view.visibleRanges) {
    const { from, to } = visible
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (matter && node.from < matter.to) return
        const name = node.name
        const revealed = overlaps(spans, node.from, node.to)

        const level = headingLevel(name)
        if (level) {
          out.push(headingLine[level - 1]!.range(state.doc.lineAt(node.from).from))
          return
        }

        switch (name) {
          case 'Blockquote': {
            const first = state.doc.lineAt(node.from)
            const callout = parseCallout(first.text)
            if (!callout) {
              decorateBlock(state, node, visible, 'cm-md-quote', out)
              return
            }

            decorateBlock(state, node, visible, 'cm-md-callout cm-md-callout-' + callout.type, out)
            if (drawn.has(node.from)) return
            drawn.add(node.from)

            // The icon stays put in both states, so revealing `[!tip]` does not
            // shift the title sideways.
            out.push(
              Decoration.widget({ widget: new CalloutIconWidget(callout.type), side: -1 }).range(
                first.from + callout.markFrom,
              ),
            )
            if (!overlaps(spans, first.from, first.to)) {
              out.push(hidden.range(first.from + callout.markFrom, first.from + callout.markTo))
            }
            if (callout.fold) {
              const folded = calloutFolded(state, first.from, callout.fold === '-')
              out.push(
                Decoration.widget({ widget: new FoldWidget(first.from, folded), side: 1 }).range(
                  first.to,
                ),
              )
            }
            return
          }
          case 'CodeBlock':
            decorateBlock(state, node, visible, 'cm-md-code', out)
            return
          case 'FencedCode': {
            decorateBlock(state, node, visible, 'cm-md-code', out)
            if (drawn.has(node.from)) return false
            drawn.add(node.from)
            const info = node.node.getChild('CodeInfo')
            const body = node.node.getChild('CodeText')
            const header = new CodeHeaderWidget(
              info ? state.doc.sliceString(info.from, info.to).trim() : '',
              body ? state.doc.sliceString(body.from, body.to) : '',
            )
            const open = state.doc.lineAt(node.from)
            const close = state.doc.lineAt(node.to)
            if (revealed) {
              // Being edited: the fences are text again, the corner stays.
              out.push(Decoration.widget({ widget: header, side: 1 }).range(open.to))
              return false
            }
            // Read only: the fences go, the language moves to the corner.
            out.push(Decoration.replace({ widget: header }).range(open.from, open.to))
            if (close.number > open.number && FENCE.test(close.text) && close.from < close.to)
              out.push(hidden.range(close.from, close.to))
            return false
          }
          case 'Image':
          case 'Embed': {
            // The markup comes back on the cursor's line like everything else,
            // and the children are left alone either way: a replaced range may
            // not contain another one.
            if (revealed || !source) return false
            if (name === 'Embed') {
              const { target, subpath } = splitLink(
                state.doc.sliceString(node.from + 3, node.to - 2),
              )
              if (!isImagePath(target)) {
                const path = target ? resolveLink(source.baseId, target, source.path) : source.path
                const widget =
                  path && /\.(md|markdown)$/i.test(path)
                    ? new NoteEmbedWidget(source, path, subpath)
                    : new FileCardWidget(source, path ?? null, target)
                out.push(Decoration.replace({ widget }).range(node.from, node.to))
                return false
              }
            }
            const spec = parseImage(state.doc.sliceString(node.from, node.to))
            if (!spec) return false
            out.push(
              Decoration.replace({
                widget: new ImageWidget(spec, source, node.from, node.to),
              }).range(node.from, node.to),
            )
            return false
          }

          case 'Paragraph': {
            if (!revealed) hideInlineExtras(state, node, out)
            // `[^1]: uma nota` is a footnote definition, drawn apart from the
            // prose around it.
            const first = state.doc.lineAt(node.from)
            if (!/^\[\^[^\]]+\]:/.test(first.text)) return
            decorateBlock(state, node, visible, 'cm-md-footnote-def', out)
            return
          }

          case 'Table':
            // A collapsed table is drawn whole by `tableBlocks`, and nothing
            // inside a replaced range may carry a decoration of its own.
            return revealed ? undefined : false

          case 'HeaderMark': {
            // Only the leading '#' of an ATX heading. The '===' of a setext
            // heading is a line of its own, and hiding it would move the text.
            if (revealed || !hasAncestor(node, 'ATXHeading' + headingLevel(node.node.parent!.name)))
              return
            const space = state.doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0
            out.push(hidden.range(node.from, node.to + space))
            return
          }
          case 'QuoteMark': {
            if (revealed) return
            const space = state.doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0
            out.push(hidden.range(node.from, node.to + space))
            return
          }
          case 'CodeMark': {
            // The fence of a code block stays, the backticks of inline code go.
            if (revealed || !hasAncestor(node, 'InlineCode')) return
            out.push(hidden.range(node.from, node.to))
            return
          }
          case 'ListMark': {
            if (node.node.parent?.parent?.name !== 'BulletList') return
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
            return
          }
          case 'TaskMarker': {
            const checked = /\[[xX]\]/.test(state.doc.sliceString(node.from, node.to))
            out.push(
              Decoration.replace({
                widget: new TaskWidget(checked, node.from, node.to),
              }).range(node.from, node.to),
            )
            return
          }
          case 'HorizontalRule': {
            if (revealed) return
            out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            return
          }
          default:
            if (revealed || !INLINE_MARKS.has(name)) return
            out.push(hidden.range(node.from, node.to))
        }
      },
    })
  }

  return Decoration.set(out, true)
}

/** Comments and block ids vanish outside the line being edited, as in Obsidian. */
function hideInlineExtras(
  state: EditorState,
  node: { from: number; to: number },
  out: Range<Decoration>[],
): void {
  const text = state.doc.sliceString(node.from, node.to)
  for (const match of text.matchAll(COMMENT)) {
    out.push(hidden.range(node.from + match.index!, node.from + match.index! + match[0].length))
  }
  let at = node.from
  for (const line of text.split('\n')) {
    const id = BLOCK_ID.exec(line)
    if (id) out.push(hidden.range(at + id.index, at + line.length))
    at += line.length + 1
  }
}

export const seamlessMarkdown = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    private spans: LineSpan[]

    constructor(view: EditorView) {
      this.decorations = build(view)
      this.spans = activeLines(view.state)
    }

    update(update: ViewUpdate): void {
      const spans = activeLines(update.state)
      const movedLine = !sameLines(spans, this.spans)
      const nudged = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(linksChanged) || effect.is(toggleCallout)),
      )
      if (!update.docChanged && !update.viewportChanged && !movedLine && !nudged) return
      this.spans = spans
      this.decorations = build(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
