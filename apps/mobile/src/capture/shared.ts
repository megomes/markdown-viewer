/**
 * What another app shared with this one, on its way to the capture screen. It
 * is kept here and not in the route: pictures do not fit in an address, and a
 * share must be used once, not again each time the screen is drawn.
 */

import type { Shared } from '../../modules/quick-capture'

let waiting: Shared | null = null

export function holdShare(shared: Shared): void {
  waiting = shared
}

/** The share that is waiting, handed over once. */
export function takeHeldShare(): Shared | null {
  const shared = waiting
  waiting = null
  return shared
}
