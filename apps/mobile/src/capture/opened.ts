/**
 * A note opened from another app, on its way to the screen that shows it.
 * Android hands it to the app once; it waits here until the screen takes it.
 */

import type { Opened } from '../../modules/quick-capture'

let waiting: Opened | null = null
const listeners = new Set<() => void>()

export function holdOpened(opened: Opened): void {
  waiting = opened
  for (const listener of listeners) listener()
}

/** The note that is waiting, handed over once. */
export function takeHeldOpened(): Opened | null {
  const opened = waiting
  waiting = null
  return opened
}

/** Whether a note is still waiting for its screen. */
export function isOpenedWaiting(): boolean {
  return waiting !== null
}

/** Called when a note arrives while the screen is already up. */
export function onOpenedHeld(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
