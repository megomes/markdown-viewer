/**
 * Over-the-air updates of the APK, from the repository's GitHub releases.
 *
 * The repository is public, so the releases are read without a token. A
 * token inside an APK anyone can download would be anyone's token.
 *
 * Installing goes through Android's own installer screen (one tap). The
 * runbook's PackageInstaller session, which can skip that tap, needs a native
 * module; it is worth it only if the tap gets in the way.
 */

import { useSyncExternalStore } from 'react'
import Constants from 'expo-constants'
import * as Application from 'expo-application'
import * as IntentLauncher from 'expo-intent-launcher'
import { File, Paths } from 'expo-file-system'
import { pickUpdate, releasesUrl, type OtaConfig, type Release, type Update } from './releases'

/** From app.json (`extra.ota`), so the repository is written in one place. */
const OTA: OtaConfig = (Constants.expoConfig?.extra as { ota?: OtaConfig } | undefined)?.ota ?? {
  repo: 'megomes/markdown-viewer',
  tagPrefix: 'android-v',
  asset: String.raw`markdown-viewer-(\d+)\.apk`,
}

/** The build number of the APK running now. A local build is 1 and loses to any release. */
export function installedCode(): number {
  return Number(Application.nativeBuildVersion ?? 0) || 0
}

export function installedLabel(): string {
  return `${Application.nativeApplicationVersion ?? '?'} (${installedCode()})`
}

export interface UpdateState {
  checking: boolean
  /** Null after a check that found nothing; undefined before any check. */
  update: Update | null | undefined
  downloading: number | null
  error: string | null
}

let state: UpdateState = { checking: false, update: undefined, downloading: null, error: null }
const listeners = new Set<() => void>()

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function useUpdates(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** Looks for a newer APK. Quiet: a failure is kept in the state, never thrown. */
export async function checkForUpdate(): Promise<Update | null> {
  if (state.checking) return state.update ?? null
  set({ checking: true, error: null })
  try {
    const response = await fetch(releasesUrl(OTA), {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`O GitHub respondeu ${response.status}.`)
    const update = pickUpdate((await response.json()) as Release[], installedCode(), OTA)
    set({ update })
    return update
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) })
    return null
  } finally {
    set({ checking: false })
  }
}

/** Downloads the APK and hands it to Android's installer. */
export async function installUpdate(update: Update): Promise<void> {
  set({ downloading: 0, error: null })
  try {
    const target = new File(Paths.cache, `markdown-viewer-${update.code}.apk`)
    if (target.exists) target.delete()
    const apk = await File.downloadFileAsync(update.url, target, {
      onProgress: ({ bytesWritten, totalBytes }) =>
        set({ downloading: totalBytes > 0 ? bytesWritten / totalBytes : null }),
    })
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: apk.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: the installer reads our file
    })
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) })
  } finally {
    set({ downloading: null })
  }
}
