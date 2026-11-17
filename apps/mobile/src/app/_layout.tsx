import { useEffect } from 'react'
import { router, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { startVault } from '../vault/runtime'
import { checkForUpdate } from '../updates/updater'
import { colors } from '../ui/theme'
import { onShare, takeShared, type Shared } from '../../modules/quick-capture'
import { holdShare } from '../capture/shared'
import { startDiagnostics } from '../diagnostics'
import { installedLabel } from '../updates/updater'

// Before anything else, so the first line of a session is in the log too.
startDiagnostics(installedLabel())

/** Something shared with the app becomes a capture, ready to be saved. */
function captureShared(shared: Shared): void {
  holdShare(shared)
  router.push('/capture')
}

export default function RootLayout() {
  useEffect(() => {
    void startVault()
    // Quiet: a newer APK shows up as a line on the vault's first screen.
    void checkForUpdate()
    // Opened by another app's "Compartilhar": after the first screen is up,
    // or the router has nowhere to push to yet.
    const opened = takeShared()
    const waiting = opened ? setTimeout(() => captureShared(opened), 300) : undefined
    const stop = onShare(captureShared)
    return () => {
      clearTimeout(waiting)
      stop()
    }
  }, [])

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgApp },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bgApp },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: 'Parear com o vault' }} />
        <Stack.Screen name="files" options={{ title: 'Vault' }} />
        <Stack.Screen name="note" options={{ title: '' }} />
        <Stack.Screen name="capture" options={{ title: 'Captura' }} />
        <Stack.Screen name="settings" options={{ title: 'Ajustes' }} />
      </Stack>
    </>
  )
}
