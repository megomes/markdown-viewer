/**
 * What the shared packages use and the phone's engine (Hermes) does not have
 * yet. The repository's lint prefers `toSorted` and `toReversed` to their
 * mutating versions, so code shared with the desktop reaches for them.
 */

/* eslint-disable no-extend-native */
const proto = Array.prototype as unknown as Record<string, unknown>

if (typeof proto.toSorted !== 'function') {
  Object.defineProperty(Array.prototype, 'toSorted', {
    value<T>(this: T[], compare?: (a: T, b: T) => number): T[] {
      // oxlint-disable-next-line unicorn/no-array-sort -- this is the copy
      return [...this].sort(compare)
    },
    writable: true,
    configurable: true,
  })
}

if (typeof proto.toReversed !== 'function') {
  Object.defineProperty(Array.prototype, 'toReversed', {
    value<T>(this: T[]): T[] {
      // oxlint-disable-next-line unicorn/no-array-reverse -- this is the copy
      return [...this].reverse()
    },
    writable: true,
    configurable: true,
  })
}
