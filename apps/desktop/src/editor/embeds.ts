/**
 * `![[…]]` that is not an image: another note drawn in place, or a card for a
 * file the editor cannot show inline (a PDF, a spreadsheet, an HTML page).
 *
 * Both open their file on click. The embedded note is read and drawn once, with
 * the same renderer the HTML export uses, and is not editable here: it is a
 * window onto the other note, as in Obsidian.
 */

import { WidgetType, type EditorView } from '@codemirror/view'
import { fileSystem } from '~/platform'
import { sameHeading } from '@markdown-viewer/core/note'
import { renderMarkdown } from './export-html'
import type { Source } from './images'
import { openTarget, resolverGeneration } from './links'

/** The part of a note a `#Título` or `#^bloco` points at, or the whole body. */
export function sliceNote(text: string, subpath: string | null): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')
  if (!subpath) return body
  const lines = body.split('\n')

  if (subpath.startsWith('^')) {
    const id = subpath.slice(1)
    const at = lines.findIndex((line) => new RegExp(`(?:^|\\s)\\^${id}\\s*$`).test(line))
    if (at < 0) return ''
    // The block is the paragraph that ends on the marked line.
    let start = at
    while (start > 0 && lines[start - 1]!.trim() !== '') start--
    return lines
      .slice(start, at + 1)
      .join('\n')
      .replace(new RegExp(`\\s*\\^${id}\\s*$`), '')
  }

  const wanted = subpath.split('#').pop()!
  const at = lines.findIndex((line) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    return m && sameHeading(m[2]!, wanted)
  })
  if (at < 0) return ''
  const level = /^(#+)/.exec(lines[at]!)![1]!.length
  let end = at + 1
  while (end < lines.length) {
    const m = /^(#{1,6})\s/.exec(lines[end]!)
    if (m && m[1]!.length <= level) break
    end++
  }
  return lines.slice(at, end).join('\n')
}

export class NoteEmbedWidget extends WidgetType {
  constructor(
    private readonly source: Source,
    private readonly path: string,
    private readonly subpath: string | null,
  ) {
    super()
  }

  eq(other: NoteEmbedWidget): boolean {
    return other.path === this.path && other.subpath === this.subpath
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'cm-md-embed-note'
    const head = document.createElement('button')
    head.type = 'button'
    head.className = 'cm-md-embed-head'
    head.textContent =
      this.path.slice(this.path.lastIndexOf('/') + 1).replace(/\.(md|markdown)$/i, '') +
      (this.subpath ? ' › ' + this.subpath.replace(/^\^/, '') : '')
    head.title = 'Abrir ' + this.path
    head.addEventListener('mousedown', (event) => {
      event.preventDefault()
      openTarget({ baseId: this.source.baseId, path: this.path, subpath: this.subpath })
    })
    const body = document.createElement('div')
    body.className = 'cm-md-embed-body'
    body.textContent = 'Carregando…'
    box.append(head, body)

    void fileSystem()
      .read(this.source.baseId, this.path)
      .then(async ({ text }) => {
        const part = sliceNote(text, this.subpath)
        body.innerHTML = part.trim()
          ? await renderMarkdown(part, { baseId: this.source.baseId, path: this.path })
          : '<p class="cm-md-embed-empty">Trecho não encontrado.</p>'
        view.requestMeasure()
      })
      .catch(() => {
        body.textContent = 'Não deu para ler a nota.'
      })
    return box
  }

  ignoreEvent(): boolean {
    return true
  }
}

const KINDS: Record<string, string> = {
  pdf: 'PDF',
  html: 'Página HTML',
  htm: 'Página HTML',
  xlsx: 'Planilha',
  xls: 'Planilha',
  csv: 'Planilha',
  docx: 'Documento',
  pptx: 'Apresentação',
  zip: 'Arquivo compactado',
  mp3: 'Áudio',
  wav: 'Áudio',
  mp4: 'Vídeo',
  mov: 'Vídeo',
}

export class FileCardWidget extends WidgetType {
  private readonly generation = resolverGeneration()

  constructor(
    private readonly source: Source,
    private readonly path: string | null,
    private readonly label: string,
  ) {
    super()
  }

  eq(other: FileCardWidget): boolean {
    return (
      other.generation === this.generation && other.path === this.path && other.label === this.label
    )
  }

  toDOM(): HTMLElement {
    const card = document.createElement('span')
    card.className = 'cm-md-embed-file' + (this.path ? '' : ' is-missing')
    const ext = this.label.slice(this.label.lastIndexOf('.') + 1).toLowerCase()
    const kind = document.createElement('span')
    kind.className = 'cm-md-embed-kind'
    kind.textContent = KINDS[ext] ?? ext.toUpperCase()
    const name = document.createElement('span')
    name.className = 'cm-md-embed-name'
    name.textContent = this.label.slice(this.label.lastIndexOf('/') + 1)
    card.append(kind, name)
    card.title = this.path ? 'Abrir ' + this.path : 'Arquivo não encontrado'
    card.addEventListener('mousedown', (event) => {
      if (!this.path) return
      event.preventDefault()
      openTarget({ baseId: this.source.baseId, path: this.path, subpath: null })
    })
    return card
  }

  ignoreEvent(): boolean {
    return true
  }
}
