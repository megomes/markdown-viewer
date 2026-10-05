/**
 * An HTML page from the vault, live: its scripts run, its relative files load,
 * and what it keeps in `localStorage` is saved in the vault (`app/html-state.ts`).
 * "Código" shows the source, read-only, because the pages are Claude's to edit.
 */

import { useEffect, useRef, useState } from 'react'
import { normalizePath } from '@markdown-viewer/core/resolver'
import { fileSystem } from '~/platform'
import { folderUrl, openWithSystem } from '~/platform/assets'
import { frameDocument, isFrameMessage } from '~/app/html-frame'
import { readHtmlState, writeHtmlState } from '~/app/html-state'
import { openTarget } from '~/editor/links'
import { CodeViewer } from './CodeViewer'
import { revisorCode } from '~/app/revisor'
import {
  buildReviewExport,
  pendingItems,
  REVIEW_KEY,
  type ReviewState,
} from '@markdown-viewer/core/review'

interface Props {
  baseId: string
  path: string
  name: string
  report: (message: string) => void
}

const SAVE_DELAY = 600

export function HtmlViewer({ baseId, path, name, report }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = useState<string | null>(null)
  const [mode, setMode] = useState<'page' | 'code'>('page')
  const [nonce, setNonce] = useState(0)
  // What the page keeps, as it changes: the Revisor's session lives in here.
  const storage = useRef<Record<string, string>>({})
  const [review, setReview] = useState<ReviewState | null>(null)
  const [copied, setCopied] = useState(false)

  const readReviewFrom = (map: Record<string, string>) => {
    try {
      return map[REVIEW_KEY] ? (JSON.parse(map[REVIEW_KEY]) as ReviewState) : null
    } catch {
      return null
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [{ text }, saved, baseHref, revisor] = await Promise.all([
          fileSystem().read(baseId, path),
          readHtmlState(baseId, path),
          folderUrl(baseId, path),
          revisorCode(baseId),
        ])
        if (cancelled) return
        storage.current = saved
        setReview(readReviewFrom(saved))
        setDoc(frameDocument(text, { baseHref, storage: saved, revisor: revisor.code }))
      } catch (error) {
        if (!cancelled) report(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [baseId, path, nonce, report])

  // The page's messages: storage to save, links to follow.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let latest: Record<string, string> | null = null
    const flush = () => {
      if (!latest) return
      const storage = latest
      latest = null
      void writeHtmlState(baseId, path, storage).catch((error: unknown) =>
        report('Não deu para guardar o estado da página: ' + String(error)),
      )
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !isFrameMessage(event.data)) return
      const message = event.data
      if (message.__mdv === 'storage') {
        latest = message.storage
        storage.current = message.storage
        setReview(readReviewFrom(message.storage))
        clearTimeout(timer)
        timer = setTimeout(flush, SAVE_DELAY)
        return
      }
      const href = message.href
      if (/^[a-z][\w+.-]*:/i.test(href)) {
        void import('@tauri-apps/plugin-opener')
          .then(({ openUrl }) => openUrl(href))
          .catch(() => window.open(href, '_blank', 'noopener'))
        return
      }
      const [file = '', hash] = href.split('#')
      let target = file.split('?')[0]!
      try {
        target = decodeURIComponent(target)
      } catch {
        // keep as written
      }
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      openTarget({
        baseId,
        path: target ? normalizePath(folder + '/' + target) : path,
        subpath: hash ?? null,
      })
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      flush()
    }
  }, [baseId, path, report])

  const pending = pendingItems(review)

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <div className="viewer-seg" role="group" aria-label="Mostrar">
          <button type="button" aria-pressed={mode === 'page'} onClick={() => setMode('page')}>
            Página
          </button>
          <button type="button" aria-pressed={mode === 'code'} onClick={() => setMode('code')}>
            Código
          </button>
        </div>
        <span className="viewer-name">{name}</span>
        {mode === 'page' && (
          <button
            type="button"
            className={'viewer-action' + (review?.active ? ' is-on' : '')}
            title="Liga o Revisor Visual: Alt + clique num elemento para comentar"
            onClick={() =>
              frame.current?.contentWindow?.postMessage(
                { __mdv: 'revisor', active: !review?.active },
                '*',
              )
            }
          >
            {review?.active ? 'Revisando' : 'Revisar'}
          </button>
        )}
        {pending.length > 0 && (
          <button
            type="button"
            className="viewer-action"
            title="Copia os pedidos no formato do Revisor, com o caminho do arquivo"
            onClick={() => {
              const text = buildReviewExport([
                {
                  filePath: fileSystem().absolutePath(baseId, path) ?? path,
                  title: name,
                  items: pending,
                },
              ])
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied
              ? 'Copiado'
              : `Copiar ${pending.length} ${pending.length === 1 ? 'pedido' : 'pedidos'}`}
          </button>
        )}
        <button type="button" className="viewer-action" onClick={() => setNonce((n) => n + 1)}>
          Recarregar
        </button>
        <button
          type="button"
          className="viewer-action"
          title="O progresso guardado no navegador é separado do que fica aqui."
          onClick={() =>
            void openWithSystem(baseId, path).then((ok) => {
              if (!ok) report('Não deu para abrir no navegador.')
            })
          }
        >
          Abrir no navegador
        </button>
      </div>
      {mode === 'page' ? (
        doc !== null && (
          <iframe
            key={nonce}
            ref={frame}
            className="viewer-frame"
            title={name}
            srcDoc={doc}
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          />
        )
      ) : (
        <CodeViewer baseId={baseId} path={path} name={name} report={report} bare />
      )}
    </div>
  )
}
