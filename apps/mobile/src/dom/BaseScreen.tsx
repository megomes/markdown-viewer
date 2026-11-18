'use dom'

/**
 * An Obsidian Base on the phone, drawn by the desktop's own `BaseView`: the
 * same tabs, tables and cards. The notes come from the phone's index; a tap on
 * a row opens its note in the app.
 */

import { useCallback, useEffect } from 'react'
import type { DOMProps } from 'expo/dom'
import type { BaseFile } from '@markdown-viewer/core/bases'
import { BaseView } from '~/ui/viewers/BaseView'
import '@fontsource-variable/inter'
import '../../../desktop/src/ui/styles.css'
import '../../../desktop/src/ui/design-system.css'
import '../../../desktop/src/ui/viewers/viewers.css'
import './base.css'

interface Props {
  name: string
  text: string
  files: BaseFile[]
  ready: boolean
  /** A cover picture, as base64, read from the vault on the phone. */
  readFileBase64: (path: string) => Promise<string>
  openNote: (path: string) => Promise<void>
  dom?: DOMProps
}

const TYPES: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

export default function BaseScreen({ name, text, files, ready, readFileBase64, openNote }: Props) {
  useEffect(() => {
    document.documentElement.dataset.theme = 'dark'
  }, [])
  const imageUrl = useCallback(
    async (path: string) => {
      const type = TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'image/jpeg'
      return { url: `data:${type};base64,${await readFileBase64(path)}` }
    },
    [readFileBase64],
  )
  return (
    <BaseView
      name={name}
      text={text}
      files={files}
      ready={ready}
      imageUrl={imageUrl}
      open={(path) => void openNote(path)}
    />
  )
}
