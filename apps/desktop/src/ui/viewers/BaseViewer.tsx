/** The desktop's Base: reads the `.base` file and the index, and shows `BaseView`. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import { fileSystem } from '~/platform'
import { fileUrl } from '~/platform/assets'
import { openTarget } from '~/editor/links'
import { BaseView, baseFiles } from './BaseView'

interface Props {
  baseId: string
  path: string
  name: string
  index: BaseIndex | undefined
  report: (message: string) => void
}

export function BaseViewer({ baseId, path, name, index, report }: Props) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fileSystem()
      .read(baseId, path)
      .then(({ text }) => {
        if (!cancelled) setText(text)
      })
      .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [baseId, path, report])

  const files = useMemo(() => baseFiles(index), [index])
  // The same function every render: a new one would fetch every cover again.
  const imageUrl = useCallback((image: string) => fileUrl(baseId, image), [baseId])

  return (
    <BaseView
      name={name}
      text={text}
      files={files}
      ready={index?.done ?? false}
      imageUrl={imageUrl}
      open={(notePath) => openTarget({ baseId, path: notePath, subpath: null })}
    />
  )
}
