/** Base64 for the bridge to the note reader, in slices so a large image does not overflow the stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const SLICE = 0x8000
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE))
  }
  return btoa(binary)
}
