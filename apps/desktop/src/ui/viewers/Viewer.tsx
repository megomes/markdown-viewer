/** The pane for a file that is not a note: picks the viewer by the file's type. */

import type { BaseIndex } from '@markdown-viewer/core/base-index'
import type { Viewer as Kind } from '@markdown-viewer/core/fs'
import { BaseViewer } from './BaseViewer'
import { CodeViewer } from './CodeViewer'
import { HtmlViewer } from './HtmlViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import './viewers.css'

interface Props {
  kind: Exclude<Kind, 'note'>
  baseId: string
  path: string
  name: string
  index: BaseIndex | undefined
  report: (message: string) => void
}

export function Viewer({ kind, baseId, path, name, index, report }: Props) {
  // Keyed by file, so moving from one PDF to another starts a fresh viewer.
  const key = baseId + ':' + path
  switch (kind) {
    case 'html':
      return <HtmlViewer key={key} baseId={baseId} path={path} name={name} report={report} />
    case 'pdf':
      return <PdfViewer key={key} baseId={baseId} path={path} name={name} report={report} />
    case 'image':
      return <ImageViewer key={key} baseId={baseId} path={path} name={name} report={report} />
    case 'code':
      return <CodeViewer key={key} baseId={baseId} path={path} name={name} report={report} />
    case 'base':
      return (
        <BaseViewer
          key={key}
          baseId={baseId}
          path={path}
          name={name}
          index={index}
          report={report}
        />
      )
  }
}
