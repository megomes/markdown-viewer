/**
 * Pairing the phone with the vault: the camera reads the QR the desktop shows
 * in Sync > Parear aparelho. Typing it is the fallback, for a camera that will
 * not focus or a desktop out of reach.
 */

import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router, Stack } from 'expo-router'
import { defaultDeviceName, parsePairingQr, type PairingCode } from '../vault/pairing'
import { pairWith } from '../vault/runtime'
import { colors, radius } from '../ui/theme'

export default function Pair() {
  const [permission, requestPermission] = useCameraPermissions()
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [typing, setTyping] = useState(false)
  const [server, setServer] = useState('')
  const [vault, setVault] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The camera reports the same QR many times a second; one attempt at a time.
  const trying = useRef(false)

  const attempt = async (pairing: PairingCode) => {
    if (trying.current) return
    trying.current = true
    setBusy(true)
    setError(null)
    try {
      await pairWith(pairing, deviceName.trim() || defaultDeviceName())
      router.replace('/files')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      trying.current = false
    }
  }

  const onScan = (data: string) => {
    const pairing = parsePairingQr(data)
    if (pairing) void attempt(pairing)
    else setError('Esse QR não é de pareamento. No desktop: Sync > Parear aparelho.')
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      {/* Ajustes before pairing too: an update may be what fixes a pairing that fails. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
              <Text style={styles.headerAction}>Ajustes</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          No desktop, abra Sync e toque em Parear aparelho. Aponte a câmera para o QR que aparecer.
        </Text>

        {!typing && (
          <View style={styles.cameraBox}>
            {permission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={busy ? undefined : ({ data }) => onScan(data)}
              />
            ) : (
              <Pressable style={styles.primary} onPress={() => void requestPermission()}>
                <Text style={styles.primaryText}>Usar a câmera</Text>
              </Pressable>
            )}
            {busy && (
              <View style={styles.overlay}>
                <ActivityIndicator color={colors.textPrimary} />
                <Text style={styles.overlayText}>Abrindo o vault…</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.label}>Nome deste aparelho</Text>
        <TextInput
          style={styles.input}
          value={deviceName}
          onChangeText={setDeviceName}
          placeholderTextColor={colors.textTertiary}
        />

        {typing ? (
          <>
            <Text style={styles.label}>Servidor</Text>
            <TextInput
              style={styles.input}
              value={server}
              onChangeText={setServer}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://…"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.label}>Vault</Text>
            <TextInput
              style={styles.input}
              value={vault}
              onChangeText={setVault}
              autoCapitalize="none"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.label}>Código de pareamento</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              placeholder="XXXXX-XXXXX"
              placeholderTextColor={colors.textTertiary}
            />
            <Pressable
              style={[styles.primary, busy && styles.disabled]}
              disabled={busy}
              onPress={() =>
                void attempt({
                  server: server.trim().replace(/\/+$/, ''),
                  vault: vault.trim(),
                  code,
                })
              }
            >
              <Text style={styles.primaryText}>{busy ? 'Abrindo o vault…' : 'Parear'}</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable onPress={() => setTyping(!typing)}>
          <Text style={styles.link}>{typing ? 'Ler o QR com a câmera' : 'Digitar o código'}</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  content: { padding: 20, gap: 10 },
  headerAction: { color: colors.textSecondary, fontSize: 14 },
  lead: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  cameraBox: {
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(5,5,8,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  overlayText: { color: colors.textPrimary },
  label: { color: colors.textTertiary, fontSize: 13, marginTop: 6 },
  input: {
    backgroundColor: colors.surface1,
    borderColor: colors.borderDefault,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  primary: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: colors.bgApp, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.6 },
  link: { color: colors.accentText, marginTop: 12, fontSize: 15 },
  error: { color: colors.accentText, marginTop: 8, lineHeight: 20 },
})
