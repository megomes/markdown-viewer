/**
 * URLs a viewer can load a vault file from.
 *
 * On the desktop that is Tauri's asset protocol, which streams the file from
 * disk with range requests: a 140 MB PDF is never read whole into memory, and an
 * HTML page finds the CSS and images beside it. In the browser and in the demo
 * the bytes go through the filesystem port into a blob URL instead.
 */

import { fileSystem, isDesktop } from '.'

let protocolBase: Promise<string> | null = null

/** `asset://localhost/` on macOS, `http://asset.localhost/` on Windows. */
function assetBase(): Promise<string> {
  protocolBase ??= import('@tauri-apps/api/core').then(({ convertFileSrc }) => convertFileSrc(''))
  return protocolBase
}

/**
 * An asset URL with the path's `/` kept as segments, so relative URLs inside the
 * file (`style.css`, `../img/a.png`) resolve against its folder. `convertFileSrc`
 * encodes the whole path as one segment, which would break that.
 */
async function assetUrl(absolute: string): Promise<string> {
  const base = await assetBase()
  const segments = absolute.replaceAll('\\', '/').split('/')
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join('/')
  return base + encoded.replace(/^\//, '')
}

/** The folder of a file as a URL ending in `/`, for `<base href>`. Null off the desktop. */
export async function folderUrl(baseId: string, path: string): Promise<string | null> {
  if (!isDesktop()) return null
  const absolute = fileSystem().absolutePath(baseId, path)
  if (!absolute) return null
  const folder = absolute.replaceAll('\\', '/').replace(/\/[^/]*$/, '')
  return (await assetUrl(folder)) + '/'
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

export interface FileUrl {
  url: string
  /** Frees a blob URL. Absent for asset URLs, which hold nothing. */
  revoke?: () => void
}

export async function fileUrl(baseId: string, path: string): Promise<FileUrl> {
  if (isDesktop()) {
    const absolute = fileSystem().absolutePath(baseId, path)
    if (absolute) return { url: await assetUrl(absolute) }
  }
  return blobUrl(baseId, path)
}

/** The bytes in memory, as a blob URL. The fallback when streaming is not there. */
export async function blobUrl(baseId: string, path: string): Promise<FileUrl> {
  const bytes = await fileSystem().readBinary(baseId, path)
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }),
  )
  return { url, revoke: () => URL.revokeObjectURL(url) }
}

/** Opens a vault file with the program the system uses for it. */
export async function openWithSystem(baseId: string, path: string): Promise<boolean> {
  const absolute = fileSystem().absolutePath(baseId, path)
  if (!absolute || !isDesktop()) return false
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener')
    await openPath(absolute)
    return true
  } catch {
    return false
  }
}
