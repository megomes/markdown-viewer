import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { startVault } from '../vault/runtime'
import { checkForUpdate } from '../updates/updater'
import { colors } from '../ui/theme'

export default function RootLayout() {
  useEffect(() => {
    void startVault()
    // Quiet: a newer APK shows up as a line on the vault's first screen.
    void checkForUpdate()
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
        <Stack.Screen name="settings" options={{ title: 'Ajustes' }} />
      </Stack>
    </>
  )
}
