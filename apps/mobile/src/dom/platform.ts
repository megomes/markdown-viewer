/**
 * `~/platform` for the desktop's editor when it runs inside the phone's note
 * reader (a DOM component, see metro.config.js).
 *
 * The page cannot touch the phone's files. It asks the native side, through the
 * function the reader received as a prop, and gets the bytes back as base64.
 * Only what the editor reads is here: images and embedded notes.
 */

import type { FileSystem } from '@markdown-viewer/core/fs'
import { decode } from '@markdown-viewer/core/text'

type ReadBase64 = (path: string) => Promise<string>

let readBase64: ReadBase64 | null = null

/** Set by the reader on every render, so the latest bridge is used. */
export function connectFiles(read: ReadBase64): void {
  readBase64 = read
}

async function readBinary(_baseId: string, path: string): Promise<Uint8Array> {
  if (!readBase64) throw new Error('Leitor sem acesso aos arquivos.')
  return Uint8Array.from(atob(await readBase64(path)), (c) => c.charCodeAt(0))
}

const phone = {
  readBinary,
  async read(baseId: string, path: string) {
    const bytes = await readBinary(baseId, path)
    const { text, shape } = decode(bytes)
    return { text, shape, version: { size: bytes.length, modifiedAt: 0 } }
  },
}

export function fileSystem(): FileSystem {
  return phone as unknown as FileSystem
}

export function isDesktop(): boolean {
  return false
}
