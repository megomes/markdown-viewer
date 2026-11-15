/**
 * Which GitHub release, if any, is an update for the APK installed here
 * (the OTA runbook in the vault: "Update OTA de app Android pelo GitHub
 * Releases"). Pure, so it can be tested without a phone.
 *
 * The repository is shared with the desktop, whose updater reads
 * `releases/latest`. The phone's releases are tagged `android-v…` and never
 * marked latest, so they are found by tag among the recent ones.
 */

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface Release {
  tag_name: string
  draft: boolean
  prerelease: boolean
  body: string | null
  assets: ReleaseAsset[]
}

export interface OtaConfig {
  repo: string
  tagPrefix: string
  /** The APK's name, with the build number as its only group. */
  asset: string
}

export interface Update {
  /** The build number: what Android compares (versionCode). */
  code: number
  /** As the person reads it, `0.8.1 (42)`. */
  label: string
  url: string
  size: number
  notes: string
}

export function releasesUrl(ota: OtaConfig): string {
  return `https://api.github.com/repos/${ota.repo}/releases?per_page=30`
}

/** The newest phone release with a build number above `installed`, or null. */
export function pickUpdate(releases: Release[], installed: number, ota: OtaConfig): Update | null {
  const pattern = new RegExp('^' + ota.asset + '$')
  let best: Update | null = null
  for (const release of releases) {
    if (release.draft || !release.tag_name.startsWith(ota.tagPrefix)) continue
    for (const asset of release.assets) {
      const match = pattern.exec(asset.name)
      if (!match) continue
      const code = Number(match[1])
      if (!(code > installed) || (best && best.code >= code)) continue
      const version = release.tag_name.slice(ota.tagPrefix.length).replace(/-\d+$/, '')
      best = {
        code,
        label: `${version} (${code})`,
        url: asset.browser_download_url,
        size: asset.size,
        notes: (release.body ?? '').trim(),
      }
    }
  }
  return best
}
