/** An image file on its own: fitted to the pane, a click for its real size. */

import { useEffect, useState } from 'react'
import { blobUrl, fileUrl, type FileUrl } from '~/platform/assets'

interface Props {
  baseId: string
  path: string
  name: string
  report: (message: string) => void
}

export function ImageViewer({ baseId, path, name, report }: Props) {
  const [source, setSource] = useState<FileUrl | null>(null)
  const [actual, setActual] = useState(false)

  useEffect(() => {
    let current: FileUrl | null = null
    let cancelled = false
    void fileUrl(baseId, path)
      .then((url) => {
        current = url
        if (cancelled) url.revoke?.()
        else setSource(url)
      })
      .catch((error: unknown) => report(String(error)))
    return () => {
      cancelled = true
      current?.revoke?.()
    }
  }, [baseId, path, report])

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-name">{name}</span>
        <span className="viewer-note">{actual ? 'Tamanho real' : 'Ajustada à tela'}</span>
      </div>
      <div
        className={'viewer-image' + (actual ? ' is-actual' : '')}
        onClick={() => setActual((a) => !a)}
      >
        {source && (
          <img
            src={source.url}
            alt={name}
            onError={() => {
              // The asset protocol refused it: fall back to reading the bytes.
              if (source.revoke) return
              void blobUrl(baseId, path).then(setSource)
            }}
          />
        )}
      </div>
    </div>
  )
}
