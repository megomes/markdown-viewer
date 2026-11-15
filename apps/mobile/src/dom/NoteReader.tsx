'use dom'

/**
 * A note, read on the phone with the desktop's own editor in read-only mode
 * (docs/spec.md, 6.8: "a mesma renderização do desktop"). Callouts, tables,
 * embeds, images, frontmatter and wiki links all come from the same code.
 *
 * It runs in a web view. What it needs from the phone comes in as props: the
 * text, the vault's paths and aliases for links, and two native actions, one
 * to read a file and one to open a link.
 */

import { useEffect, useRef } from 'react'
import type { DOMProps } from 'expo/dom'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createResolver } from '@markdown-viewer/core/resolver'
import { isPlainText } from '@markdown-viewer/core/fs'
import { editorExtensions } from '~/editor/setup'
import { linksChanged, setLinkOpener, setVaultResolver } from '~/editor/links'
import { connectFiles } from './platform'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../../desktop/src/ui/styles.css'
import '../../../desktop/src/ui/design-system.css'
import './reader.css'

const BASE = 'vault'

export interface NoteReaderProps {
  text: string
  path: string
  title: string
  paths: string[]
  aliases: [string, string][]
  readFileBase64: (path: string) => Promise<string>
  openLink: (path: string, subpath: string | null) => Promise<void>
  dom?: DOMProps
}

export default function NoteReader({
  text,
  path,
  title,
  paths,
  aliases,
  readFileBase64,
  openLink,
}: NoteReaderProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  connectFiles(readFileBase64)

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark'
  }, [])

  useEffect(() => {
    setLinkOpener((target) => void openLink(target.path, target.subpath))
    return () => setLinkOpener(null)
  }, [openLink])

  useEffect(() => {
    setVaultResolver(BASE, createResolver(paths, aliases))
    view.current?.dispatch({ effects: linksChanged.of(null) })
  }, [paths, aliases])

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const state = EditorState.create({
      doc: text,
      extensions: editorExtensions({
        title,
        baseId: BASE,
        path,
        plainText: isPlainText(path),
        readOnly: true,
        onSave: () => {},
      }),
    })
    const instance = new EditorView({ state, parent })
    view.current = instance
    return () => {
      instance.destroy()
      view.current = null
    }
  }, [text, path, title])

  return <div className="editor reader" ref={host} />
}
