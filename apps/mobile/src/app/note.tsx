/**
 * One file of the vault. Notes open in the desktop's editor, for reading; the
 * "Editar" button turns it into the same live preview the desktop writes in,
 * and what is typed is saved by itself. Images open as images. HTML, PDF, Bases
 * and code get their viewers in the next deliveries of stage 8, and say so
 * instead of showing nothing.
 *
 * The screen holds the file's id, not its path. Renaming or moving the note,
 * here or on another device, changes its title and nothing else: the editor,
 * the caret and the keyboard stay where they are.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isTextFile, viewerOf } from '@markdown-viewer/core/fs'
import NoteEditor from '../dom/NoteEditor'
import { bytesToBase64 } from '../vault/base64'
import { PhoneFiles } from '../vault/storage'
import {
  attachImage,
  fileOf,
  idAt,
  isOwnWrite,
  nameProblem,
  readFile,
  readText,
  relocate,
  saveText,
  useVault,
} from '../vault/runtime'
import { colors, radius } from '../ui/theme'

const files = new PhoneFiles()

const LATER: Record<string, string> = {
  html: 'HTML',
  pdf: 'PDF',
  base: 'Bases',
  code: 'código',
}

/** What is on screen: one version of the file, read from the device. */
interface Shown {
  id: string
  text?: string
  /** Goes up each time a version from outside the editor is read. */
  revision: number
  imageUri?: string
  error?: string
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Room for the keyboard: the window does not shrink for it (edge to edge). */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    // From the top of the keyboard to the bottom of the screen: the height it
    // reports leaves out the strip under the keys.
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setHeight(
        Math.max(
          event.endCoordinates.height,
          Dimensions.get('screen').height - event.endCoordinates.screenY,
        ),
      ),
    )
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  return height
}

export default function Note() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>()
  const vault = useVault()
  const file = useMemo(
    () => vault.files.find((item) => item.fileId === id) ?? null,
    [vault.files, id],
  )
  const path = file?.path ?? null
  // Kept after the file is gone, so the screen can still say which one it was.
  const [lastName, setLastName] = useState('')
  const name = path ? path.slice(path.lastIndexOf('/') + 1) : lastName
  if (name !== lastName) setLastName(name)
  const viewer = viewerOf(name)
  const isNote = isTextFile(name)
  const hash = file?.hash ?? null

  const [editing, setEditing] = useState(edit === '1')
  // A note made a moment ago starts with the caret in its name.
  const [naming, setNaming] = useState(edit === '1')
  const [shown, setShown] = useState<Shown | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardHeight()
  /** Whether the editor already has a version of this file to write over. */
  const opened = useRef<string | null>(null)

  // Reads the file when it is first opened and when a version arrives that the
  // editor here did not write. Keyed by id and version, never by path.
  useEffect(() => {
    if (hash === null) return
    const now = fileOf(id)
    if (!now) return
    // The editor's own text, saved and coming back: it already has it, and
    // loading it would put it over what was typed since.
    if (isNote && opened.current === id && isOwnWrite(id, hash)) return
    let live = true
    const show = (value: Omit<Shown, 'id' | 'revision'>) => {
      if (!live) return
      opened.current = id
      setShown((old) => ({ id, revision: (old?.revision ?? 0) + 1, ...value }))
    }
    const load = isNote
      ? readText(now.path).then((text) => show({ text }))
      : viewer === 'image'
        ? readFile(now.path).then(() => show({ imageUri: files.uri(now.path) + '?v=' + hash }))
        : Promise.resolve()
    load.catch((e: unknown) => show({ error: messageOf(e) }))
    return () => {
      live = false
    }
  }, [id, hash, isNote, viewer])

  const current = shown?.id === id ? shown : null
  const text = current?.text ?? null
  const imageUri = current?.imageUri ?? null
  const error = current?.error ?? null

  const paths = useMemo(() => vault.index.paths, [vault.index])
  const aliases = useMemo(() => {
    const out: [string, string][] = []
    for (const item of Object.values(vault.index.files))
      for (const alias of item.aliases) out.push([alias, item.path])
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
    const targetId = idAt(target)
    if (targetId) setTimeout(() => router.push({ pathname: '/note', params: { id: targetId } }), 50)
  }, [])

  const onChange = useCallback(
    async (next: string) => {
      // The screen keeps what the editor has, without counting it as a version
      // from outside. If Android restarts the web view, the editor is built
      // from this, and not from a text that is several saves old.
      setShown((old) => (old?.id === id ? { ...old, text: next } : old))
      try {
        await saveText(id, next)
        setSaveError(null)
      } catch (e) {
        setSaveError(messageOf(e))
      }
    },
    [id],
  )

  const rename = useCallback(
    async (stem: string) => {
      const problem = nameProblem(stem)
      if (problem) return problem
      const now = fileOf(id)
      if (!now) return 'Esta nota não existe mais no vault.'
      const slash = now.path.lastIndexOf('/')
      const old = now.path.slice(slash + 1)
      const dot = old.lastIndexOf('.')
      const target = now.path.slice(0, slash + 1) + stem.trim() + (dot > 0 ? old.slice(dot) : '')
      try {
        await relocate(now.path, target)
      } catch (e) {
        return messageOf(e)
      }
      setNaming(false)
      return null
    },
    [id],
  )

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) return null
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85 }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options)
      const asset = result.canceled ? null : result.assets[0]
      if (!asset) return null
      const fromName = /\.([a-z0-9]{2,5})$/i.exec(asset.fileName ?? asset.uri)?.[1]
      const fromType = asset.mimeType?.split('/')[1]
      const extension = (fromName ?? fromType ?? 'jpg').toLowerCase().replace('jpeg', 'jpg')
      return await attachImage(await new File(asset.uri).bytes(), extension)
    } catch (e) {
      setSaveError(messageOf(e))
      return null
    }
  }, [])

  const title = name.replace(/\.(md|markdown)$/i, '')
  const toggleEditing = useCallback(() => {
    setEditing((on) => !on)
    setNaming(false)
  }, [])
  const headerRight = useCallback(
    () => (
      <Pressable onPress={toggleEditing} hitSlop={12}>
        <Text style={[styles.headerAction, editing && styles.headerActionOn]}>
          {editing ? 'Concluir' : 'Editar'}
        </Text>
      </Pressable>
    ),
    [editing, toggleEditing],
  )

  return (
    <View style={[styles.screen, { paddingBottom: keyboard > 0 ? keyboard : insets.bottom }]}>
      <Stack.Screen options={{ title, headerRight: isNote && file ? headerRight : undefined }} />
      {saveError ? <Text style={styles.saveError}>Não deu para salvar: {saveError}</Text> : null}
      {!file && vault.phase === 'ready' ? (
        <Text style={styles.message}>
          {name
            ? `"${name}" não está mais no vault: foi apagada ou substituída em outro aparelho.`
            : 'Este arquivo não está no vault.'}
        </Text>
      ) : error ? (
        <Text style={styles.message}>Não deu para abrir: {error}</Text>
      ) : isNote ? (
        text === null || path === null ? (
          <ActivityIndicator style={styles.loading} color={colors.textSecondary} />
        ) : (
          <NoteEditor
            text={text}
            revision={current?.revision ?? 0}
            path={path}
            title={title}
            paths={paths}
            aliases={aliases}
            editing={editing}
            naming={naming}
            readFileBase64={readFileBase64}
            openLink={openLink}
            onChange={onChange}
            rename={rename}
            pickImage={pickImage}
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
  headerAction: { color: colors.textSecondary, fontSize: 15 },
  headerActionOn: { color: colors.accentText, fontWeight: '600' },
  saveError: {
    color: colors.accentText,
    fontSize: 13,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
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
