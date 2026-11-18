/**
 * An HTML page of the vault, live, for reading: its scripts run and its CSS and
 * images load from its folder on the device. Links to other vault files open
 * them in the app, links to the web open the browser, and `#seção` stays on the
 * page. Nothing on the page is saved: editing the pages is the desktop's job.
 */

import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, Text } from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import { router } from 'expo-router'
import { decode } from '@markdown-viewer/core/text'
import { vaultDir, PhoneFiles } from '../vault/storage'
import { idAt, readFile, useVault } from '../vault/runtime'
import {
  htmlStatePath,
  pageDocument,
  relativeAssets,
  storageOf,
  vaultPathOf,
} from '../vault/html-page'
import { colors } from './theme'

const files = new PhoneFiles()
/** Fetched before the page shows; a page with more waits for none of the rest. */
const MAX_ASSETS = 60

interface Props {
  path: string
  /** The version on the device: a new one reloads the page. */
  hash: string
  desktop: boolean
}

export function HtmlPage({ path, hash, desktop }: Props) {
  const vault = useVault()
  const [loaded, setLoaded] = useState<{ html: string; storage: Record<string, string> } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoaded(null)
    setError(null)
    void (async () => {
      try {
        const html = decode(await readFile(path)).text
        const known = new Map(vault.files.map((file) => [file.path, file]))
        // What the page loads by itself and is not on the device yet: the
        // phone only downloads notes and small images up front.
        const missing = relativeAssets(html, path)
          .filter((asset) => known.get(asset)?.local === false)
          .slice(0, MAX_ASSETS)
        await Promise.all(missing.map((asset) => readFile(asset).catch(() => null)))
        const statePath = htmlStatePath(path)
        const state = known.has(statePath)
          ? decode(await readFile(statePath).catch(() => new Uint8Array())).text
          : null
        if (live) setLoaded({ html, storage: storageOf(state) })
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      live = false
    }
    // The catalog changes on every sync; the page is read again only for a new version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, hash])

  const source = useMemo(
    () =>
      loaded
        ? {
            html: pageDocument(loaded.html, { storage: loaded.storage, desktop }),
            // Its own file as the address: relative files load from its folder,
            // and "#seção" is a place on this page, not the folder.
            baseUrl: files.uri(path),
          }
        : null,
    [loaded, desktop, path],
  )

  const follow = (request: WebViewNavigation): boolean => {
    const { url } = request
    if (url.startsWith('about:') || url.startsWith('data:')) return true
    const target = url.startsWith('file:') ? vaultPathOf(url, vaultDir.uri) : null
    if (target === path) return true
    if (target) {
      const id = idAt(target)
      if (id) router.push({ pathname: '/note', params: { id } })
      return false
    }
    if (/^(https?|mailto|tel):/i.test(url)) {
      void Linking.openURL(url)
      return false
    }
    return false
  }

  if (error) return <Text style={styles.message}>Não deu para abrir: {error}</Text>
  if (!source) return <ActivityIndicator style={styles.loading} color={colors.textSecondary} />
  return (
    <WebView
      // A new layout width needs a page laid out from scratch.
      key={desktop ? 'computador' : 'celular'}
      source={source}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      setBuiltInZoomControls
      setDisplayZoomControls={false}
      onShouldStartLoadWithRequest={follow}
      style={styles.page}
    />
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bgApp },
  loading: { marginTop: 40 },
  message: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, padding: 20 },
})
