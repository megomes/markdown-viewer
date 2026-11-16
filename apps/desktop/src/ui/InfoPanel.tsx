import { memo, useEffect, useState } from 'react'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import type { Heading } from '~/editor/outline'
import { pathIn, type Tab } from '~/app/store'
import { entryId } from '@markdown-viewer/core/fs'
import { MarkdownIcon } from './icons'
import { NoteComments } from './NoteComments'
import { resolveImage } from '~/editor/images'
import { resolveLink } from '~/editor/links'
import { viewerOf } from '@markdown-viewer/core/fs'
import { FileIcon } from './icons'
import { Link2, ListTree, MessageSquare, Paperclip } from 'lucide-react'

type Page = 'sumario' | 'links' | 'anexos' | 'comentarios'

const PAGES: { id: Page; label: string; Icon: typeof ListTree }[] = [
  { id: 'sumario', label: 'Sumário', Icon: ListTree },
  { id: 'links', label: 'Links', Icon: Link2 },
  { id: 'anexos', label: 'Anexos', Icon: Paperclip },
  { id: 'comentarios', label: 'Comentários', Icon: MessageSquare },
]

interface Props {
  tab: Tab
  headings: Heading[]
  index: BaseIndex | undefined
  /** What the note embeds that is not a note, as written in it. */
  attachments: string[]
  onGoTo: (position: number) => void
  onOpenPath: (baseId: string, path: string) => void
  /** Finds and selects a quoted passage in the open note. */
  onFind: (text: string) => void
}

export const InfoPanel = memo(function InfoPanel({
  tab,
  headings,
  index,
  attachments,
  onGoTo,
  onOpenPath,
  onFind,
}: Props) {
  const [page, setPage] = useState<Page>('sumario')

  return (
    <aside className="info">
      {/* Icons, not words: four words do not fit the width this panel opens at. */}
      <div className="info-tabs" role="tablist">
        {PAGES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            aria-label={label}
            title={label}
            className={'info-tab' + (page === id ? ' is-active' : '')}
            onClick={() => setPage(id)}
          >
            <Icon size={15} strokeWidth={1.75} />
            {id === 'anexos' && attachments.length > 0 && (
              <span className="info-tab-count">{attachments.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="info-body">
        {page === 'sumario' ? (
          <Outline headings={headings} onGoTo={onGoTo} />
        ) : page === 'anexos' ? (
          <Attachments tab={tab} attachments={attachments} onOpenPath={onOpenPath} />
        ) : page === 'comentarios' ? (
          <NoteComments baseId={tab.baseId} path={tab.path} name={tab.name} onFind={onFind} />
        ) : (
          <Links tab={tab} index={index} onOpenPath={onOpenPath} />
        )}
      </div>
    </aside>
  )
})

function Outline({ headings, onGoTo }: { headings: Heading[]; onGoTo: (at: number) => void }) {
  if (headings.length === 0) {
    return <p className="info-empty">Este arquivo não tem títulos.</p>
  }

  // The smallest level present becomes the left edge, so a file that starts at
  // `##` does not sit indented for no reason.
  const top = Math.min(...headings.map((heading) => heading.level))

  return (
    <ul className="info-list">
      {headings.map((heading) => (
        <li key={heading.from}>
          <button
            type="button"
            className="info-row"
            style={{ paddingLeft: 0.5 + (heading.level - top) * 0.75 + 'rem' }}
            title={heading.text}
            onClick={() => onGoTo(heading.from)}
          >
            <span className="info-level">H{heading.level}</span>
            <span className="info-name">{heading.text}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

interface LinksProps {
  tab: Tab
  index: BaseIndex | undefined
  onOpenPath: (baseId: string, path: string) => void
}

function Links({ tab, index, onOpenPath }: LinksProps) {
  if (!index) {
    return <p className="info-empty">Um arquivo aberto de fora não pertence a nenhuma pasta.</p>
  }

  if (!index.done) {
    const percent = index.total === 0 ? 0 : Math.round((index.scanned / index.total) * 100)
    return (
      <p className="info-empty">
        Lendo a pasta: {index.scanned} de {index.total} arquivos ({percent}%).
      </p>
    )
  }

  const id = entryId(tab.baseId, tab.path)
  const incoming = index.backlinks[id] ?? []
  const outgoing = index.files[id]?.links ?? []

  // Every link here is in this tab's base, so its path is what follows the base.
  const label = (entry: string) => index.files[entry]?.title ?? pathIn(entry, tab.baseId) ?? entry

  return (
    <>
      <p className="info-title">Apontam para este ({incoming.length})</p>
      {incoming.length === 0 ? (
        <p className="info-empty">Nenhum arquivo aponta para este.</p>
      ) : (
        <ul className="info-list">
          {incoming.map((entry) => {
            const file = index.files[entry]
            return (
              <li key={entry}>
                <button
                  type="button"
                  className="info-row"
                  title={file?.path}
                  onClick={() => file && onOpenPath(file.baseId, file.path)}
                >
                  <MarkdownIcon size={14} className="tree-icon is-markdown" />
                  <span className="info-name">{label(entry)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="info-title">Este aponta para ({outgoing.length})</p>
      {outgoing.length === 0 ? (
        <p className="info-empty">Este arquivo não aponta para nenhum outro.</p>
      ) : (
        <ul className="info-list">
          {outgoing.map((path) => (
            <li key={path}>
              <button
                type="button"
                className="info-row"
                title={path}
                onClick={() => onOpenPath(tab.baseId, path)}
              >
                <MarkdownIcon size={14} className="tree-icon is-markdown" />
                <span className="info-name">
                  {index.files[entryId(tab.baseId, path)]?.title ?? path}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** The pictures and files the note carries, wherever in the vault they are kept. */
function Attachments({
  tab,
  attachments,
  onOpenPath,
}: {
  tab: Tab
  attachments: string[]
  onOpenPath: (baseId: string, path: string) => void
}) {
  if (attachments.length === 0) {
    return (
      <p className="info-empty">
        Esta nota não tem anexos. Cole uma imagem no texto e ela é guardada na pasta Files do
        ambiente.
      </p>
    )
  }
  return (
    <ul className="info-attachments">
      {attachments.map((target) => (
        <Attachment key={target} tab={tab} target={target} onOpenPath={onOpenPath} />
      ))}
    </ul>
  )
}

function Attachment({
  tab,
  target,
  onOpenPath,
}: {
  tab: Tab
  target: string
  onOpenPath: (baseId: string, path: string) => void
}) {
  const path = resolveLink(tab.baseId, target, tab.path) ?? null
  const name = target.slice(target.lastIndexOf('/') + 1)
  const image = viewerOf(name) === 'image'
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!image) return
    let live = true
    void resolveImage({ baseId: tab.baseId, path: tab.path }, target).then((found) => {
      if (live) setUrl(found)
    })
    return () => {
      live = false
    }
  }, [image, tab.baseId, tab.path, target])

  return (
    <li>
      <button
        type="button"
        className={'info-attachment' + (path ? '' : ' is-missing')}
        title={path ?? 'Não encontrado no vault: ' + target}
        disabled={!path}
        onClick={() => path && onOpenPath(tab.baseId, path)}
      >
        {image && url ? (
          <img src={url} alt="" loading="lazy" />
        ) : (
          <span className="info-attachment-file">
            <FileIcon size={18} />
          </span>
        )}
        <span className="info-name">{name}</span>
      </button>
    </li>
  )
}
