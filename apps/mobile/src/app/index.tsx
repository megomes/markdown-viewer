import { ActivityIndicator, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useVault } from '../vault/runtime'
import { colors } from '../ui/theme'

/** Where the app starts: the vault when the phone is paired, pairing when not. */
export default function Start() {
  const { phase } = useVault()
  if (phase === 'unpaired') return <Redirect href="/pair" />
  if (phase === 'ready') return <Redirect href="/files" />
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bgApp,
      }}
    >
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  )
}
