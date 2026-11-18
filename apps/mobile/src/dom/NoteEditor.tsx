'use dom'

/**
 * A note on the phone, in the desktop's own editor (docs/spec.md, 6.8: "a mesma
 * renderização do desktop"). Callouts, tables, embeds, images, frontmatter and
 * wiki links all come from the same code.
 *
 * It opens for reading. With `editing` on it is the desktop's live preview: the
 * line being written shows its Markdown, the rest stays rendered. The bar of
 * marks above the keyboard is native (`ui/MarkdownBar`) and sends its taps in
 * as `command`.
 *
 * It runs in a web view. What it needs from the phone comes in as props: the
 * text, the vault's paths and aliases for links, and native actions to read a
 * file, open a link, save, rename and pick an image.
 */

import { useEffect, useRef } from 'react'
import type { DOMProps } from 'expo/dom'
import { redo, undo } from '@codemirror/commands'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, type Command } from '@codemirror/view'
import { createResolver } from '@markdown-viewer/core/resolver'
import { isPlainText } from '@markdown-viewer/core/fs'
import { editorExtensions } from '~/editor/setup'
import { insertBeforeCaret, toggleBold, toggleItalic, toggleTask } from '~/editor/commands'
import { documentTitle, requestTitleFocus, titleCompartment } from '~/editor/title'
import { linksChanged, setLinkOpener, setVaultResolver } from '~/editor/links'
import { connectFiles } from './platform'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../../desktop/src/ui/styles.css'
import '../../../desktop/src/ui/design-system.css'
import './editor.css'

const BASE = 'vault'
/** How long after the last key the text is handed to the phone to be saved. */
const SAVE_DELAY = 300

/** A change that came from the phone (a sync), not from typing: it is not saved back. */
const fromOutside = Annotation.define<boolean>()

export interface NoteEditorProps {
  text: string
  /** Goes up when `text` is a version from outside that has to replace what is shown. */
  revision: number
  path: string
  title: string
  paths: string[]
  aliases: [string, string][]
  editing: boolean
  /** A note just created: the caret starts in its name. */
  naming: boolean
  readFileBase64: (path: string) => Promise<string>
  openLink: (path: string, subpath: string | null) => Promise<void>
  onChange: (text: string) => Promise<void>
  /** Resolves to why the name was refused, or null when it was taken. */
  rename: (stem: string) => Promise<string | null>
  /** Resolves to the file name of the picture saved in the vault, or null. */
  pickImage: (source: 'camera' | 'library') => Promise<string | null>
  /** A tap on the bar above the keyboard. A new `id` runs it once. */
  command?: { id: number; name: EditorCommand } | null
  /** Called once the note is drawn, so the screen can drop its loading sign. */
  onReady?: () => Promise<void>
  dom?: DOMProps
}

export type EditorCommand =
  'heading' | 'list' | 'task' | 'link' | 'bold' | 'italic' | 'camera' | 'library' | 'undo' | 'redo'

const HEADING = /^(#{1,6})\s+/

/** No heading, then `#`, `##`, `###`, and back to none. */
const cycleHeading: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const level = HEADING.exec(line.text)?.[1]?.length ?? 0
  const marks = level >= 3 ? '' : '#'.repeat(level + 1) + ' '
  const old = HEADING.exec(line.text)?.[0].length ?? 0
  insertBeforeCaret(view, { from: line.from, to: line.from + old, insert: marks }, 'input.heading')
  return true
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+/

const toggleList: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const match = LIST.exec(line.text)
  const indent = /^\s*/.exec(line.text)![0].length
  insertBeforeCaret(
    view,
    match
      ? { from: line.from + match[1]!.length, to: line.from + match[0].length, insert: '' }
      : { from: line.from + indent, insert: '- ' },
    'input.list',
  )
  return true
}

/** `[[ ]]` around the selection, with the caret inside: the link to another note. */
const wikiLink: Command = (view) => {
  const range = view.state.selection.main
  const inside = view.state.sliceDoc(range.from, range.to)
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: '[[' + inside + ']]' },
    selection: { anchor: range.from + 2 + inside.length },
    userEvent: 'input.link',
  })
  return true
}

/**
 * The smallest replacement that turns one text into the other: what the two
 * share at the start and at the end is left alone, so the caret and the scroll
 * stay where they were when a version arrives from another device.
 */
function changeBetween(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  const limit = Math.min(before.length, after.length)
  let start = 0
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (
    end < limit - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  )
    end++
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

function insertEmbed(view: EditorView, name: string): void {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const alone = line.text.trim() === ''
  const insert = (alone ? '' : '\n') + '![[' + name + ']]\n'
  const at = alone ? line.from : line.to
  view.dispatch({
    changes: { from: at, to: alone ? line.to : at, insert },
    selection: { anchor: at + insert.length },
    userEvent: 'input.image',
    scrollIntoView: true,
  })
}

export default function NoteEditor({
  text,
  revision,
  path,
  title,
  paths,
  aliases,
  editing,
  naming,
  readFileBase64,
  openLink,
  onChange,
  rename,
  pickImage,
  command,
  onReady,
}: NoteEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The latest props, for the listeners that outlive a render.
  const latest = useRef({ text, onChange, rename })
  latest.current = { text, onChange, rename }
  const pending = useRef<number | null>(null)
  const shownRevision = useRef(revision)
  const builtFor = useRef(title)

  connectFiles(readFileBase64)

  const flush = () => {
    if (pending.current === null) return
    window.clearTimeout(pending.current)
    pending.current = null
    const current = view.current
    if (current) void latest.current.onChange(current.state.doc.toString())
  }

  // What was typed is saved under the old name first, then the name changes.
  const renameFromTitle = (stem: string) => (flush(), latest.current.rename(stem))

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark'
    const leave = () => flush()
    document.addEventListener('visibilitychange', leave)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', leave)
      window.removeEventListener('pagehide', leave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setLinkOpener((target) => void openLink(target.path, target.subpath))
    return () => setLinkOpener(null)
  }, [openLink])

  useEffect(() => {
    setVaultResolver(BASE, createResolver(paths, aliases))
    view.current?.dispatch({ effects: linksChanged.of(null) })
  }, [paths, aliases])

  // The editor is built once, and again only when reading turns into editing:
  // tables, embeds and the title all draw differently for a text that can be
  // changed. A new name or a new version of the text never rebuilds it.
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const before = view.current
    const doc = before ? before.state.doc.toString() : latest.current.text
    const scroll = before?.scrollDOM.scrollTop ?? 0
    before?.destroy()
    if (editing && naming) requestTitleFocus()

    const state = EditorState.create({
      doc,
      extensions: [
        ...editorExtensions({
          title,
          baseId: BASE,
          path,
          plainText: isPlainText(path),
          readOnly: !editing,
          onSave: () => flush(),
          rename: editing ? renameFromTitle : null,
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          if (update.transactions.some((tr) => tr.annotation(fromOutside))) return
          if (pending.current !== null) window.clearTimeout(pending.current)
          pending.current = window.setTimeout(flush, SAVE_DELAY)
        }),
      ],
    })
    const instance = new EditorView({ state, parent })
    view.current = instance
    instance.scrollDOM.scrollTop = scroll
    // After the first paint, not before: what the screen uncovers is the note.
    requestAnimationFrame(() => void onReady?.())
    builtFor.current = title
    return () => {
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  // Renamed from its own title: only the title is drawn again. Building the
  // editor again would drop the caret and close the keyboard in mid sentence.
  useEffect(() => {
    if (builtFor.current === title) return
    builtFor.current = title
    view.current?.dispatch({
      effects: titleCompartment.reconfigure(
        documentTitle(title, false, editing ? renameFromTitle : null),
      ),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  useEffect(
    () => () => {
      view.current?.destroy()
      view.current = null
    },
    [],
  )

  // A version from outside (a sync that merged or replaced the note).
  useEffect(() => {
    if (revision === shownRevision.current) return
    shownRevision.current = revision
    const current = view.current
    const shown = current?.state.doc.toString()
    if (!current || shown === undefined || shown === text) return
    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = null
    current.dispatch({ changes: changeBetween(shown, text), annotations: fromOutside.of(true) })
  }, [revision, text])

  const attach = (source: 'camera' | 'library') => {
    flush()
    void pickImage(source).then((name) => {
      const current = view.current
      if (name && current) insertEmbed(current, name)
    })
  }

  // What the bar above the keyboard sent, run once per tap.
  const ranCommand = useRef(command?.id ?? 0)
  useEffect(() => {
    if (!command || command.id === ranCommand.current) return
    ranCommand.current = command.id
    const current = view.current
    if (!current) return
    if (command.name === 'camera' || command.name === 'library') {
      attach(command.name)
      return
    }
    if (!current.hasFocus) current.focus()
    COMMANDS[command.name](current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command])

  return (
    <div className={'note' + (editing ? ' is-editing' : '')}>
      <div className="editor reader" ref={host} />
    </div>
  )
}

const COMMANDS: Record<Exclude<EditorCommand, 'camera' | 'library'>, Command> = {
  heading: cycleHeading,
  list: toggleList,
  task: toggleTask,
  link: wikiLink,
  bold: toggleBold,
  italic: toggleItalic,
  undo,
  redo,
}
