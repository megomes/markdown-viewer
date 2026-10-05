/**
 * Ties the editor's links to the app: each base's resolver, kept current as the
 * index is built, and what following a link does.
 *
 * A note opens in a tab, and lands on the heading or block the link names. A
 * file that is not text goes to whatever the system opens it with, until the
 * app has a viewer of its own for it.
 */

import { useEffect, useRef, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { resolverOf, type BaseIndex } from '@markdown-viewer/core/base-index'
import { entryId, viewerOf } from '@markdown-viewer/core/fs'
import { sameHeading } from '@markdown-viewer/core/note'
import { fileSystem, isDesktop } from '~/platform'
import { linksChanged, setLinkOpener, setVaultResolver, type LinkTarget } from '~/editor/links'
import type { Heading } from '~/editor/outline'
import type { Tab } from '~/app/store'

interface Options {
  indexes: Record<string, BaseIndex>
  editor: RefObject<EditorView | null>
  activeTab: Tab | null
  headings: Heading[]
  /** Opens a text file of a base in a tab. */
  openText: (baseId: string, path: string) => void
  report: (message: string) => void
}

/** Moves the editor to `#Título` or `#^bloco`. False when it is not in the note. */
export function goToAnchor(view: EditorView, headings: Heading[], subpath: string): boolean {
  let position: number | null = null
  // `@L12` is the app's own: a line, from the search results.
  const line = /^@L(\d+)$/.exec(subpath)
  if (line) {
    const number = Math.min(Number(line[1]) + 1, view.state.doc.lines)
    position = view.state.doc.line(number).from
  } else if (subpath.startsWith('^')) {
    const id = subpath.slice(1)
    const text = view.state.doc.toString()
    const match = new RegExp(`(?:^|\\s)\\^${id.replace(/[^\w-]/g, '')}\\s*$`, 'm').exec(text)
    if (match) position = view.state.doc.lineAt(match.index + 1).from
  } else {
    const wanted = subpath.split('#').pop()!
    position = headings.find((heading) => sameHeading(heading.text, wanted))?.from ?? null
  }
  if (position === null) return false
  view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
  view.focus()
  return true
}

async function openOutside(baseId: string, path: string): Promise<boolean> {
  const absolute = fileSystem().absolutePath(baseId, path)
  if (!absolute || !isDesktop()) return false
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener')
    await openPath(absolute)
    return true
  } catch {
    return false
  }
}

export function useVaultLinks({ indexes, editor, activeTab, headings, openText, report }: Options) {
  const pending = useRef<{ id: string; subpath: string } | null>(null)
  const latest = useRef({ activeTab, headings, openText, report })
  useEffect(() => {
    latest.current = { activeTab, headings, openText, report }
  })

  // Each finished index gives its base a resolver, and the open note redraws
  // its links against it.
  useEffect(() => {
    let changed = false
    for (const [baseId, index] of Object.entries(indexes)) {
      if (!index.done) continue
      setVaultResolver(baseId, resolverOf(index))
      changed = true
    }
    if (changed) editor.current?.dispatch({ effects: linksChanged.of(null) })
  }, [indexes, editor])

  useEffect(() => {
    setLinkOpener((target: LinkTarget) => {
      const { activeTab: tab, openText: open, report: say } = latest.current
      const name = target.path.slice(target.path.lastIndexOf('/') + 1)
      if (!viewerOf(name)) {
        void openOutside(target.baseId, target.path).then((ok) => {
          if (!ok) say('Este tipo de arquivo ainda não abre aqui: ' + name)
        })
        return
      }
      const id = entryId(target.baseId, target.path)
      if (tab?.id === id) {
        const view = editor.current
        if (target.subpath && view) goToAnchor(view, latest.current.headings, target.subpath)
        return
      }
      pending.current = target.subpath ? { id, subpath: target.subpath } : null
      open(target.baseId, target.path)
    })
    return () => setLinkOpener(null)
  }, [editor])

  // The note a link opened is read and parsed a moment later. Its outline
  // arriving is the sign that the heading can be found.
  useEffect(() => {
    const wanted = pending.current
    const view = editor.current
    if (!wanted || !view || activeTab?.id !== wanted.id) return
    if (goToAnchor(view, headings, wanted.subpath) || headings.length > 0) pending.current = null
  }, [headings, activeTab, editor])
}
