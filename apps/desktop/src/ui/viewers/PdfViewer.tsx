/**
 * PDFs with pdf.js: continuous scroll, the text layer for selecting and finding,
 * zoom, and going to a page.
 *
 * On the desktop the file is streamed from disk in chunks, so a 140 MB manual
 * shows its first page without being read whole. Elsewhere, or if streaming is
 * refused, the bytes are read into memory.
 */

import { useEffect, useRef, useState } from 'react'
import { blobUrl, fileUrl, openWithSystem } from '~/platform/assets'

interface Props {
  baseId: string
  path: string
  name: string
  report: (message: string) => void
}

type PdfJs = typeof import('pdfjs-dist')
type ViewerModule = typeof import('pdfjs-dist/web/pdf_viewer.mjs')

let loading: Promise<{ pdfjs: PdfJs; viewer: ViewerModule }> | null = null

/** pdf.js and its viewer, loaded the first time a PDF is opened. */
function loadPdfJs() {
  loading ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    // The viewer module reads the library from the global, by design.
    ;(globalThis as unknown as { pdfjsLib: PdfJs }).pdfjsLib = pdfjs
    await import('pdfjs-dist/web/pdf_viewer.css')
    const viewer = await import('pdfjs-dist/web/pdf_viewer.mjs')
    return { pdfjs, viewer }
  })()
  return loading
}

export function PdfViewer({ baseId, path, name, report }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<InstanceType<ViewerModule['PDFViewer']> | null>(null)
  const busRef = useRef<InstanceType<ViewerModule['EventBus']> | null>(null)
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('Abrindo…')

  useEffect(() => {
    const host = container.current
    if (!host) return
    let cancelled = false
    const cleanups: (() => void)[] = []

    void (async () => {
      try {
        const { pdfjs, viewer: V } = await loadPdfJs()
        if (cancelled) return
        const eventBus = new V.EventBus()
        const linkService = new V.PDFLinkService({ eventBus })
        const findController = new V.PDFFindController({ eventBus, linkService })
        const viewer = new V.PDFViewer({
          container: host,
          eventBus,
          linkService,
          findController,
          removePageBorders: true,
        })
        linkService.setViewer(viewer)
        viewerRef.current = viewer
        busRef.current = eventBus
        eventBus.on('pagesinit', () => {
          viewer.currentScaleValue = 'page-width'
        })
        eventBus.on('pagechanging', (event: { pageNumber: number }) => setPage(event.pageNumber))

        const open = async (url: string) => {
          const task = pdfjs.getDocument({
            url,
            rangeChunkSize: 1 << 20,
            disableAutoFetch: true,
          })
          cleanups.push(() => void task.destroy())
          return task.promise
        }
        let source = await fileUrl(baseId, path)
        let pdf
        try {
          pdf = await open(source.url)
        } catch {
          // Streaming refused: read the file into memory and try again.
          source = await blobUrl(baseId, path)
          pdf = await open(source.url)
        }
        if (cancelled) {
          source.revoke?.()
          return
        }
        const opened = source
        cleanups.push(() => opened.revoke?.())
        viewer.setDocument(pdf)
        linkService.setDocument(pdf)
        setPages(pdf.numPages)
        setStatus('')
      } catch (error) {
        setStatus('Não deu para abrir o PDF.')
        report(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      cancelled = true
      viewerRef.current = null
      for (const cleanup of cleanups) cleanup()
    }
  }, [baseId, path, report])

  const zoom = (factor: number | 'page-width') => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (factor === 'page-width') viewer.currentScaleValue = 'page-width'
    else viewer.currentScale = Math.min(5, Math.max(0.25, viewer.currentScale * factor))
  }

  const find = (again: boolean, back = false) => {
    busRef.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: back,
    })
  }

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-name">{name}</span>
        {pages > 0 && (
          <span className="viewer-pages">
            <input
              className="viewer-page"
              value={page}
              onChange={(e) => setPage(Number(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && viewerRef.current) {
                  viewerRef.current.currentPageNumber = Math.min(Math.max(page, 1), pages)
                }
              }}
              aria-label="Página"
            />
            de {pages}
          </span>
        )}
        <button
          type="button"
          className="viewer-action"
          onClick={() => zoom(1 / 1.2)}
          aria-label="Diminuir"
        >
          −
        </button>
        <button type="button" className="viewer-action" onClick={() => zoom('page-width')}>
          Largura
        </button>
        <button
          type="button"
          className="viewer-action"
          onClick={() => zoom(1.2)}
          aria-label="Aumentar"
        >
          +
        </button>
        <input
          className="viewer-find"
          placeholder="Buscar no PDF"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') find(true, e.shiftKey)
          }}
          onBlur={() => query && find(false)}
        />
        <button
          type="button"
          className="viewer-action"
          onClick={() =>
            void openWithSystem(baseId, path).then((ok) => {
              if (!ok) report('Não deu para abrir no leitor do sistema.')
            })
          }
        >
          Abrir fora
        </button>
      </div>
      {status && <p className="viewer-status">{status}</p>}
      <div className="viewer-pdf-frame">
        <div className="viewer-pdf" ref={container}>
          <div className="pdfViewer" />
        </div>
      </div>
    </div>
  )
}
