/**
 * Ajustes: which version is installed, the update, and this device's pairing.
 */

import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { unpair, useVault } from '../vault/runtime'
import { checkForUpdate, installedLabel, installUpdate, useUpdates } from '../updates/updater'
import { colors, radius } from '../ui/theme'

export default function Settings() {
  const vault = useVault()
  const updates = useUpdates()

  const confirmUnpair = () =>
    Alert.alert(
      'Desparear este aparelho?',
      (vault.pending > 0
        ? `ATENÇÃO: ${vault.pending} ${vault.pending === 1 ? 'alteração feita aqui ainda não foi enviada e será perdida' : 'alterações feitas aqui ainda não foram enviadas e serão perdidas'}. `
        : '') +
        'A cópia do vault neste aparelho é apagada. O vault e os outros aparelhos não mudam.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desparear',
          style: 'destructive',
          onPress: () => void unpair().then(() => router.replace('/pair')),
        },
      ],
    )

  const updateLine = updates.checking
    ? 'Procurando…'
    : updates.error
      ? updates.error
      : updates.update
        ? `Versão ${updates.update.label} disponível.`
        : updates.update === null
          ? 'Esta é a versão mais nova.'
          : ''

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Aplicativo</Text>
      <View style={styles.card}>
        <Row label="Versão" value={installedLabel()} />
        {updateLine ? <Text style={styles.note}>{updateLine}</Text> : null}
        {updates.update ? (
          <Pressable
            style={[styles.primary, updates.downloading !== null && styles.disabled]}
            disabled={updates.downloading !== null}
            onPress={() => void installUpdate(updates.update!)}
          >
            <Text style={styles.primaryText}>
              {updates.downloading === null
                ? 'Atualizar'
                : `Baixando ${Math.round((updates.downloading ?? 0) * 100)}%`}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.secondary, updates.checking && styles.disabled]}
            disabled={updates.checking}
            onPress={() => void checkForUpdate()}
          >
            <Text style={styles.secondaryText}>Buscar atualização</Text>
          </Pressable>
        )}
      </View>

      {vault.phase === 'ready' ? (
        <>
          <Text style={styles.section}>Vault</Text>
          <View style={styles.card}>
            <Row label="Este aparelho" value={vault.deviceName ?? ''} />
            <Row label="Arquivos" value={String(vault.files.length)} />
            <Row label="Baixados" value={String(vault.files.filter((file) => file.local).length)} />
            <Row label="Esperando envio" value={String(vault.pending)} />
            <Pressable style={styles.secondary} onPress={confirmUnpair}>
              <Text style={[styles.secondaryText, styles.danger]}>Desparear</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  content: { padding: 20, gap: 8 },
  section: { color: colors.textTertiary, fontSize: 13, marginTop: 12, marginBottom: 4 },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { color: colors.textSecondary, fontSize: 15 },
  value: { color: colors.textPrimary, fontSize: 15, flexShrink: 1, textAlign: 'right' },
  note: { color: colors.textTertiary, fontSize: 14, lineHeight: 20 },
  primary: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: colors.bgApp, fontWeight: '600', fontSize: 15 },
  secondary: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: { color: colors.textPrimary, fontSize: 15 },
  danger: { color: colors.accentText },
  disabled: { opacity: 0.6 },
})
