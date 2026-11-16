/**
 * Quick capture: a note written in a hurry, from the widget, or made of what
 * another app shared (a page, a text, pictures). It asks for nothing but the
 * text: the name comes from the first line and the folder is the one used last.
 *
 * Saved, it gets out of the way: back to where the person was, which after a
 * share is the other app.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native'
import { router, Stack } from 'expo-router'
import { File } from 'expo-file-system'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown, Folder, Inbox } from 'lucide-react-native'
import { accentOf } from '@markdown-viewer/core/environments'
import { copyToCache } from '../../modules/quick-capture'
import { takeHeldShare } from '../capture/shared'
import {
  capture,
  captureFolders,
  environmentOf,
  setCaptureFolder,
  useVault,
} from '../vault/runtime'
import { colors, radius } from '../ui/theme'
import { hasVaultIcon, VaultIcon } from '../ui/VaultIcon'

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export default function Capture() {
  const vault = useVault()
  const insets = useSafeAreaInsets()
  // Taken once, when the screen is made: the share is this capture's and no other's.
  const [shared] = useState(takeHeldShare)
  const [title, setTitle] = useState('')
  const [text, setText] = useState(shared?.text ?? '')
  const [images, setImages] = useState<string[]>([])
  const [choosing, setChoosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [keyboard, setKeyboard] = useState(0)

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboard(event.endCoordinates.height),
    )
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

  // Shared pictures are copied into the app before the other app takes them back.
  useEffect(() => {
    if (!shared?.images.length) return
    let live = true
    void Promise.all(shared.images.map((address) => copyToCache(address).catch(() => null))).then(
      (copies) => {
        if (live) setImages(copies.filter((copy): copy is string => copy !== null))
      },
    )
    return () => {
      live = false
    }
  }, [shared])

  const folder = vault.captureFolder
  const environment = environmentOf(folder, vault.environments)
  const accent = environment ? accentOf(vault.environmentColors[environment]).dark : colors.accent
  const folders = useMemo(
    () => ['', ...captureFolders(vault.files, vault.folders)],
    [vault.files, vault.folders],
  )
  const empty = !text.trim() && !title.trim() && images.length === 0

  const leave = () => {
    if (router.canGoBack()) router.back()
    // Opened by a share or by the widget, with nothing behind it: back to
    // where the person was, not into the vault.
    else BackHandler.exitApp()
  }

  const save = async () => {
    if (empty || saving) return
    setSaving(true)
    setProblem(null)
    try {
      const pictures = []
      for (const address of images) {
        const extension = /\.([a-z0-9]{2,5})$/i.exec(address)?.[1] ?? 'jpg'
        pictures.push({
          bytes: await new File(address).bytes(),
          extension: extension.toLowerCase().replace('jpeg', 'jpg'),
        })
      }
      await capture({ folder, title, subject: shared?.subject ?? '', text, images: pictures })
      ToastAndroid.show(
        'Guardado em ' + (folder ? folder.slice(folder.lastIndexOf('/') + 1) : 'Vault'),
        ToastAndroid.SHORT,
      )
      leave()
    } catch (error) {
      setProblem(messageOf(error))
      setSaving(false)
    }
  }

  if (vault.phase !== 'ready') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Captura' }} />
        {vault.phase === 'loading' ? (
          <ActivityIndicator style={styles.loading} color={colors.textSecondary} />
        ) : (
          <Text style={styles.message}>
            Este aparelho ainda não está pareado com o vault. Abra o app e pareie primeiro.
          </Text>
        )}
      </View>
    )
  }

  return (
    <View style={[styles.screen, { paddingBottom: keyboard > 0 ? keyboard : insets.bottom }]}>
      <Stack.Screen
        options={{
          title: 'Captura',
          headerRight: () => (
            <Pressable onPress={() => void save()} disabled={empty || saving} hitSlop={12}>
              <Text style={[styles.save, { color: accent }, (empty || saving) && styles.off]}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <Pressable style={styles.where} onPress={() => setChoosing(true)}>
        {hasVaultIcon(vault.icons[folder]) ? (
          <VaultIcon name={vault.icons[folder]!} size={16} color={accent} />
        ) : (
          <Inbox size={16} color={accent} strokeWidth={1.75} />
        )}
        <Text style={styles.whereText} numberOfLines={1}>
          {folder || 'Vault (raiz)'}
        </Text>
        <ChevronDown size={16} color={colors.textTertiary} strokeWidth={1.75} />
      </Pressable>
      {problem ? <Text style={styles.problem}>Não deu para salvar: {problem}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <TextInput
          style={styles.title}
          value={title}
          onChangeText={setTitle}
          placeholder={shared?.subject || 'Título (opcional)'}
          placeholderTextColor={colors.textTertiary}
          returnKeyType="next"
        />
        <TextInput
          style={styles.text}
          value={text}
          onChangeText={setText}
          placeholder="Escreva aqui…"
          placeholderTextColor={colors.textTertiary}
          multiline
          autoFocus
          textAlignVertical="top"
        />
        {images.length > 0 ? (
          <View style={styles.images}>
            {images.map((address) => (
              <Image key={address} source={{ uri: address }} style={styles.image} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={choosing}
        transparent
        animationType="fade"
        onRequestClose={() => setChoosing(false)}
      >
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setChoosing(false)} />
          <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <Text style={styles.sheetTitle}>Guardar as capturas em</Text>
            <FlatList
              style={styles.folders}
              data={folders}
              keyExtractor={(item) => item || '/'}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setChoosing(false)
                    void setCaptureFolder(item)
                  }}
                  style={({ pressed }) => [styles.folderRow, pressed && styles.pressed]}
                >
                  <View style={{ width: item ? 14 * (item.split('/').length - 1) : 0 }} />
                  {hasVaultIcon(vault.icons[item]) ? (
                    <VaultIcon name={vault.icons[item]!} size={16} color={colors.textSecondary} />
                  ) : (
                    <Folder size={16} color={colors.textTertiary} strokeWidth={1.75} />
                  )}
                  <Text
                    style={[styles.folderText, item === folder && { color: accent }]}
                    numberOfLines={1}
                  >
                    {item ? item.slice(item.lastIndexOf('/') + 1) : 'Vault (raiz)'}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  loading: { marginTop: 40 },
  message: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, padding: 20 },
  save: { fontSize: 16, fontWeight: '600' },
  off: { opacity: 0.4 },
  where: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    maxWidth: '92%',
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  whereText: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
  problem: { color: colors.accentText, fontSize: 13, paddingHorizontal: 20, paddingVertical: 6 },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '600',
    paddingVertical: 10,
  },
  text: { color: colors.textPrimary, fontSize: 16, lineHeight: 24, minHeight: 160 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  image: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingTop: 18,
    paddingHorizontal: 12,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  folders: { maxHeight: 420 },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 13,
    borderRadius: radius.md,
  },
  folderText: { color: colors.textPrimary, fontSize: 16, flexShrink: 1 },
  pressed: { backgroundColor: colors.surfaceHover },
})
