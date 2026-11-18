/**
 * A file the app does not show itself (PDF, documents, spreadsheets, audio):
 * handed to the app Android picks for that kind of file. A PDF goes there as
 * soon as it is opened. A file not on the device yet comes down first, with
 * the screen saying so, since a manual can take a while.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import * as IntentLauncher from 'expo-intent-launcher'
import { File } from 'expo-file-system'
import { ExternalLink } from 'lucide-react-native'
import { PhoneFiles } from '../vault/storage'
import { readFile } from '../vault/runtime'
import { colors, radius } from './theme'

const files = new PhoneFiles()

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  epub: 'application/epub+zip',
}

export function typeOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? '*/*'
}

function megabytes(size: number): string {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(size / 1024)} KB`
}

interface Props {
  path: string
  name: string
  size: number
  local: boolean
  /** Said under the name, for the kinds the app will show itself one day. */
  note?: string
  /** Opens the file in the other app at once, as a PDF does. */
  openAtOnce?: boolean
}

export function OutsideFile({ path, name, size, local, note, openAtOnce }: Props) {
  const [state, setState] = useState<'idle' | 'downloading' | 'opening'>('idle')
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(async () => {
    setError(null)
    try {
      if (!local) setState('downloading')
      await readFile(path)
      setState('opening')
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: new File(files.uri(path)).contentUri,
        type: typeOf(name),
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: the other app reads our file
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(
        /No Activity found|ActivityNotFound/i.test(message)
          ? 'Nenhum app deste celular abre esse tipo de arquivo.'
          : message,
      )
    } finally {
      setState('idle')
    }
  }, [path, name, local])

  const started = useRef(false)
  useEffect(() => {
    if (!openAtOnce || started.current) return
    started.current = true
    void open()
  }, [openAtOnce, open])

  const busy = state !== 'idle'
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{name}</Text>
      <Text style={styles.detail}>
        {megabytes(size)}
        {local ? '' : ', ainda não baixado'}
      </Text>
      {note ? <Text style={styles.detail}>{note}</Text> : null}
      <Pressable
        onPress={() => void open()}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.textPrimary} />
        ) : (
          <ExternalLink size={18} color={colors.textPrimary} strokeWidth={1.75} />
        )}
        <Text style={styles.buttonText}>
          {state === 'downloading'
            ? 'Baixando…'
            : state === 'opening'
              ? 'Abrindo…'
              : 'Abrir em outro app'}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    margin: 20,
    padding: 20,
    gap: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  detail: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  button: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  error: { color: colors.accentText, fontSize: 14, lineHeight: 20 },
})
