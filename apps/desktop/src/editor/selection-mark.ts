/**
 * The selection, painted on the text itself.
 *
 * CodeMirror draws the selection in a layer behind the lines. A line with a
 * background of its own (a code block, a callout) covers that layer, and the
 * selection inside it could not be seen: only the other occurrences of the
 * selected text showed, lit by `highlightSelectionMatches`, which looked like a
 * selection in the wrong place. A mark on the selected text is part of the
 * line, so it shows over any background. The layer still paints the ends of
 * the lines, in the same colour.
 */

import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'

const selected = Decoration.mark({ class: 'cm-md-selected' })

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const range of view.state.selection.ranges) {
    if (!range.empty) builder.add(range.from, range.to, selected)
  }
  return builder.finish()
}

export const selectionMark = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate): void {
      if (update.selectionSet || update.docChanged) this.decorations = build(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
