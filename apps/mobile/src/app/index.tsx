import { useEffect } from 'react'
import { Redirect } from 'expo-router'
import { useVault } from '../vault/runtime'
import { hideLaunch, LaunchScreen } from '../ui/LaunchScreen'

/**
 * Where the app starts: the vault when the phone is paired, pairing when not.
 * Until the vault says which, the launch screen stays.
 */
export default function Start() {
  const { phase } = useVault()
  useEffect(() => {
    if (phase !== 'loading') hideLaunch()
  }, [phase])
  if (phase === 'unpaired') return <Redirect href="/pair" />
  if (phase === 'ready') return <Redirect href="/files" />
  return <LaunchScreen />
}
