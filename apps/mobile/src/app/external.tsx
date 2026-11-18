/**
 * A note opened from another app (a file manager, Drive, an e-mail), with this
 * app chosen for .md and .txt. It is not in the vault: it is shown with the
 * same editor, and saved back where it came from when that app allows it.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import { Check, Pencil } from 'lucide-react-native'
import NoteEditor from '../dom/NoteEditor'
import { takeOpened, writeOpened, type Opened } from '../../modules/quick-capture'
import { onOpenedHeld, takeHeldOpened } from '../capture/opened'
import { colors } from '../ui/theme'

const NO_PATHS: string[] = []
const NO_ALIASES: [string, string][] = []

export default function External() {
  const [opened, setOpened] = useState<Opened | null>(() => takeHeldOpened() ?? takeOpened())
  const [revision, setRevision] = useState(1)
  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [drawn, setDrawn] = useState(false)

  // Another note opened from outside while this screen is up takes its place.
  useEffect(
    () =>
      onOpenedHeld(() => {
        const next = takeHeldOpened()
        if (!next) return
        setOpened(next)
        setRevision((n) => n + 1)
        setEditing(false)
        setSaveError(null)
      }),
    [],
  )

  const onChange = useCallback(
    async (text: string) => {
      if (!opened?.writable) return
      try {
        await writeOpened(opened.uri, text)
        setSaveError(null)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
      }
    },
    [opened],
  )

  const name = opened?.name ?? ''
  const title = name.replace(/\.(md|markdown|txt)$/i, '')
  const headerRight = useCallback(
    () =>
      opened?.writable ? (
        <Pressable
          onPress={() => setEditing((on) => !on)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Concluir' : 'Editar'}
        >
          {editing ? (
            <Check size={23} color={colors.accentText} strokeWidth={2.25} />
          ) : (
            <Pencil size={21} color={colors.textSecondary} strokeWidth={1.75} />
          )}
        </Pressable>
      ) : null,
    [opened, editing],
  )

  if (!opened) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Arquivo' }} />
        <Text style={styles.message}>Nenhum arquivo para mostrar.</Text>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title, headerRight }} />
      <Text style={styles.where}>
        Fora do vault{opened.writable ? '' : ', só leitura: o app de origem não deixa salvar'}
      </Text>
      {saveError ? <Text style={styles.error}>Não deu para salvar: {saveError}</Text> : null}
      {opened.error ? (
        <Text style={styles.message}>Não deu para abrir: {opened.error}</Text>
      ) : (
        <View style={styles.editorBox}>
          <NoteEditor
            text={opened.text}
            revision={revision}
            path={name}
            title={title}
            paths={NO_PATHS}
            aliases={NO_ALIASES}
            editing={editing}
            naming={false}
            readFileBase64={async () => {
              throw new Error('Fora do vault')
            }}
            openLink={async () => {}}
            onChange={onChange}
            rename={async () => 'Um arquivo de fora do vault não muda de nome por aqui.'}
            pickImage={async () => null}
            onReady={async () => setDrawn(true)}
            dom={{ style: { flex: 1, backgroundColor: colors.bgApp } }}
          />
          {drawn ? null : (
            <View style={styles.cover} pointerEvents="none">
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  where: { color: colors.textTertiary, fontSize: 13, paddingHorizontal: 20, paddingBottom: 6 },
  message: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, padding: 20 },
  error: { color: colors.accentText, fontSize: 13, paddingHorizontal: 20, paddingBottom: 6 },
  editorBox: { flex: 1 },
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 40,
    backgroundColor: colors.bgApp,
  },
})
