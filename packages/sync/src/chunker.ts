/**
 * Content-defined chunking (FastCDC).
 *
 * Cut points come from the content itself, not from fixed offsets, so inserting a
 * page in the middle of a 140 MB PDF changes one or two chunks and not every
 * chunk after it. Equal chunks get equal ids, and only new chunks travel.
 *
 * Sizes: a file under MIN is one chunk; chunks average AVG and never pass MAX.
 */

export const MIN_CHUNK = 1 << 20 // 1 MiB
export const AVG_CHUNK = 4 << 20 // 4 MiB
export const MAX_CHUNK = 8 << 20 // 8 MiB

// The gear table: 256 pseudo-random 32-bit values, fixed so that every device
// cuts the same file at the same places.
const GEAR = new Uint32Array(256)
{
  let seed = 0x2545f491
  for (let i = 0; i < 256; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    GEAR[i] = seed >>> 0
  }
}

// Normalized chunking: a stricter mask before the average, a looser one after.
const BITS = Math.log2(AVG_CHUNK)
const MASK_S = ((1 << (BITS + 2)) - 1) >>> 0
const MASK_L = ((1 << (BITS - 2)) - 1) >>> 0

function cut(data: Uint8Array, start: number): number {
  const remaining = data.length - start
  if (remaining <= MIN_CHUNK) return data.length
  const end = start + Math.min(remaining, MAX_CHUNK)
  const normal = start + Math.min(remaining, AVG_CHUNK)
  let hash = 0
  let i = start + MIN_CHUNK
  for (; i < normal; i++) {
    hash = ((hash << 1) + GEAR[data[i]!]!) >>> 0
    if ((hash & MASK_S) === 0) return i + 1
  }
  for (; i < end; i++) {
    hash = ((hash << 1) + GEAR[data[i]!]!) >>> 0
    if ((hash & MASK_L) === 0) return i + 1
  }
  return end
}

/** The chunks of a file, as views into its bytes (no copies). */
export function chunk(data: Uint8Array): Uint8Array[] {
  if (data.length === 0) return [data]
  const chunks: Uint8Array[] = []
  let start = 0
  while (start < data.length) {
    const end = cut(data, start)
    chunks.push(data.subarray(start, end))
    start = end
  }
  return chunks
}
