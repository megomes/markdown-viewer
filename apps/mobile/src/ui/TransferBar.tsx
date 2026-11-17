/**
 * How far the sync pass is, one way: files coming down from the server or
 * going up to it. The same bar as the desktop's sync panel.
 */

import { StyleSheet, Text, View } from 'react-native'
import type { MirrorProgress } from '@markdown-viewer/sync/mirror'
import { colors } from './theme'

export function TransferBar({ progress, accent }: { progress: MirrorProgress; accent?: string }) {
  const share = progress.total ? Math.min(1, progress.done / progress.total) : 0
  const label = progress.direction === 'upload' ? 'Enviando' : 'Baixando'
  return (
    <View style={styles.box} accessibilityRole="progressbar" accessibilityLabel={label}>
      <View style={styles.line}>
        <Text style={styles.text}>
          {label} {progress.done} de {progress.total}
        </Text>
        <Text style={styles.text}>{Math.round(share * 100)}%</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${share * 100}%`, backgroundColor: accent ?? colors.accent },
          ]}
        />
      </View>
      {progress.path ? (
        <Text style={styles.path} numberOfLines={1}>
          {progress.path}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  text: { color: colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.surfaceHover },
  fill: { height: '100%', borderRadius: 2 },
  path: { color: colors.textTertiary, fontSize: 11 },
})
