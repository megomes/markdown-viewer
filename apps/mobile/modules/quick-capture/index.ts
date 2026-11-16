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
  addListener(event: 'onShare', listener: (shared: Shared) => void): { remove(): void }
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
