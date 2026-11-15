/**
 * One file of the vault. Notes open in the desktop's editor, read-only; images
 * open as images. HTML, PDF, Bases and code get their viewers in the next
 * deliveries of stage 8, and say so instead of showing nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { isTextFile, viewerOf } from '@markdown-viewer/core/fs'
import NoteReader from '../dom/NoteReader'
import { bytesToBase64 } from '../vault/base64'
import { PhoneFiles } from '../vault/storage'
import { readFile, readText, useVault } from '../vault/runtime'
import { colors, radius } from '../ui/theme'

const files = new PhoneFiles()

const LATER: Record<string, string> = {
  html: 'HTML',
  pdf: 'PDF',
  base: 'Bases',
  code: 'código',
}

export default function Note() {
  const { path } = useLocalSearchParams<{ path: string }>()
  const name = path.slice(path.lastIndexOf('/') + 1)
  const viewer = viewerOf(name)
  const isNote = isTextFile(name)
  const vault = useVault()
  // The file on the device, or the version just synced: read again when it changes.
  const stamp = vault.files.find((file) => file.path === path)?.hash
  const key = path + '@' + (stamp ?? '')
  const [loaded, setLoaded] = useState<{
    key: string
    text?: string
    imageUri?: string
    error?: string
  } | null>(null)
  useEffect(() => {
    let live = true
    const done = (value: { text?: string; imageUri?: string; error?: string }) => {
      if (live) setLoaded({ key, ...value })
    }
    const load = isNote
      ? readText(path).then((text) => done({ text }))
      : viewer === 'image'
        ? readFile(path).then(() => done({ imageUri: files.uri(path) + '?v=' + (stamp ?? '') }))
        : Promise.resolve()
    load.catch((e: unknown) => done({ error: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [key, path, stamp, isNote, viewer])
  // Another file is never shown while this one loads. An older version of this
  // same file stays until the new one is read: swapping the reader for a
  // spinner would tear down its web view in the middle of reading an image.
  const current = loaded?.key.startsWith(path + '@') ? loaded : null
  const text = current?.text ?? null
  const imageUri = current?.imageUri ?? null
  const error = current?.error ?? null

  const paths = useMemo(() => vault.index.paths, [vault.index])
  const aliases = useMemo(() => {
    const out: [string, string][] = []
    for (const file of Object.values(vault.index.files))
      for (const alias of file.aliases) out.push([alias, file.path])
    return out
  }, [vault.index])

  const readFileBase64 = useCallback(
    async (wanted: string) => bytesToBase64(await readFile(wanted)),
    [],
  )
  // The answer to this call goes back into the note's web view; navigating in
  // the same moment took that view off screen first and the answer had nowhere
  // to land. The next note opens just after.
  const openLink = useCallback(async (target: string) => {
    setTimeout(() => router.push({ pathname: '/note', params: { path: target } }), 50)
  }, [])

  const title = name.replace(/\.(md|markdown)$/i, '')

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      {error ? (
        <Text style={styles.message}>Não deu para abrir: {error}</Text>
      ) : isNote ? (
        text === null ? (
          <ActivityIndicator style={styles.loading} color={colors.textSecondary} />
        ) : (
          <NoteReader
            text={text}
            path={path}
            title={title}
            paths={paths}
            aliases={aliases}
            readFileBase64={readFileBase64}
            openLink={openLink}
            dom={{ style: { flex: 1, backgroundColor: colors.bgApp } }}
          />
        )
      ) : viewer === 'image' ? (
        imageUri ? (
          <ScrollView maximumZoomScale={4} contentContainerStyle={styles.imageBox}>
            <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
          </ScrollView>
        ) : (
          <ActivityIndicator style={styles.loading} color={colors.textSecondary} />
        )
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{name}</Text>
          <Text style={styles.message}>
            {viewer && LATER[viewer]
              ? `O visualizador de ${LATER[viewer]} chega na próxima entrega do app no celular.`
              : 'Este tipo de arquivo ainda não abre no celular.'}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  loading: { marginTop: 40 },
  message: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, padding: 20 },
  imageBox: { flexGrow: 1, justifyContent: 'center' },
  image: { width: '100%', aspectRatio: 1 },
  card: {
    margin: 20,
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
})
