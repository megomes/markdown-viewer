/**
 * Where an address Android opens the app with goes. A note opened from another
 * app arrives as its `content://` or `file://` address, which is no screen of
 * the app: it goes to the one that shows notes from outside the vault.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(content|file):/i.test(path) ? '/external' : path
}
