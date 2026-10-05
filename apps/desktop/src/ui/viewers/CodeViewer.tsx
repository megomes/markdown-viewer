/**
 * Source files, read-only, with the highlighting of their language: the `.py`,
 * `.lua`, `.json` and the rest of what lives in the vault beside the notes.
 */

import { useEffect, useRef } from 'react'
import {
  LanguageDescription,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'
import { keymap } from '@codemirror/view'
import { fileSystem } from '~/platform'

interface Props {
  baseId: string
  path: string
  name: string
  report: (message: string) => void
  /** Inside another viewer, with no bar of its own. */
  bare?: boolean
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', background: 'var(--bg-content)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-gutters': {
    background: 'var(--bg-content)',
    color: 'var(--text-tertiary)',
    border: 'none',
  },
  '.cm-content': { padding: '12px 0' },
})

export function CodeViewer({ baseId, path, name, report, bare = false }: Props) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let view: EditorView | null = null
    let cancelled = false
    void (async () => {
      try {
        const { text } = await fileSystem().read(baseId, path)
        const language = LanguageDescription.matchFilename(languages, name)
        const support = language ? await language.load() : null
        if (cancelled) return
        view = new EditorView({
          parent,
          state: EditorState.create({
            doc: text,
            extensions: [
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              lineNumbers(),
              search({ top: true }),
              keymap.of(searchKeymap),
              syntaxHighlighting(defaultHighlightStyle),
              theme,
              ...(support ? [support] : []),
            ],
          }),
        })
      } catch (error) {
        report(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
      view?.destroy()
    }
  }, [baseId, path, name, report])

  if (bare) return <div className="viewer-code" ref={host} />
  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-name">{name}</span>
        <span className="viewer-note">Só leitura</span>
      </div>
      <div className="viewer-code" ref={host} />
    </div>
  )
}
