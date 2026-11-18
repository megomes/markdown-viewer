/**
 * The app's side of the native module: what another app shared with this one,
 * and what the widget on the home screen shows. Only Android has it; anywhere
 * else every call is a quiet nothing.
 */

import { requireOptionalNativeModule } from 'expo'

export interface Shared {
  text: string
  subject: string
  /** Addresses of shared pictures, readable through `copyToCache`. */
  images: string[]
}

/** A note opened from another app, outside the vault. */
export interface Opened {
  /** Where it came from: written back to when `writable`. */
  uri: string
  name: string
  text: string
  writable: boolean
  /** Why it could not be read, or ''. */
  error: string
}

export interface WidgetNote {
  id: string
  title: string
  text: string
  /** The colour of its environment, as `#rrggbb`, or '' for the app's own. */
  color: string
}

interface Native {
  takeShared(): Shared | null
  copyToCache(address: string): Promise<string>
  setWidgetNotes(json: string): void
  takeOpened(): Opened | null
  writeOpened(uri: string, text: string): Promise<void>
  addListener(event: 'onShare', listener: (shared: Shared) => void): { remove(): void }
  addListener(event: 'onOpenFile', listener: (opened: Opened) => void): { remove(): void }
}

const native = requireOptionalNativeModule<Native>('QuickCapture')

/** What the app was opened with, by a share. Given once. */
export function takeShared(): Shared | null {
  return native?.takeShared() ?? null
}

/** Shared while the app was open. Resolves to a function that stops listening. */
export function onShare(listener: (shared: Shared) => void): () => void {
  const subscription = native?.addListener('onShare', listener)
  return () => subscription?.remove()
}

/** Copies a shared picture to the app's cache; resolves to its `file://` address. */
export function copyToCache(address: string): Promise<string> {
  if (!native) return Promise.reject(new Error('Só no Android.'))
  return native.copyToCache(address)
}

export function setWidgetNotes(notes: WidgetNote[]): void {
  native?.setWidgetNotes(JSON.stringify(notes))
}

/** The note the app was opened with, from another app. Given once. */
export function takeOpened(): Opened | null {
  return native?.takeOpened() ?? null
}

/** A note opened from another app while this one was open. */
export function onOpenFile(listener: (opened: Opened) => void): () => void {
  const subscription = native?.addListener('onOpenFile', listener)
  return () => subscription?.remove()
}

/** Saves an opened note back where it came from. */
export function writeOpened(uri: string, text: string): Promise<void> {
  if (!native) return Promise.reject(new Error('Só no Android.'))
  return native.writeOpened(uri, text)
}
