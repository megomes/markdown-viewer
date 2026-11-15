/**
 * The vault's tree, one folder per screen: tapping a folder goes into it, the
 * back gesture comes out. Folders first, then files, as on the desktop.
 */

import { useMemo } from 'react'
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { childrenOf, syncNow, unpair, useVault, type TreeNode } from '../vault/runtime'
import { colors } from '../ui/theme'

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

function timeLabel(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Files() {
  const { folder = '' } = useLocalSearchParams<{ folder?: string }>()
  const vault = useVault()
  const nodes = useMemo(() => childrenOf(vault.files, folder), [vault.files, folder])
  const title = folder ? folder.slice(folder.lastIndexOf('/') + 1) : 'Vault'

  const status = vault.syncing
    ? vault.progress
      ? `Sincronizando ${vault.progress.done} de ${vault.progress.total}`
      : 'Sincronizando…'
    : vault.error
      ? 'Sem conexão com o servidor. O que já está no aparelho abre normalmente.'
      : vault.lastSync
        ? `Atualizado às ${timeLabel(vault.lastSync)}`
        : ''

  const confirmUnpair = () =>
    Alert.alert(
      'Desparear este aparelho?',
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

  const open = (node: TreeNode) => {
    if (node.kind === 'directory')
      router.push({ pathname: '/files', params: { folder: node.path } })
    else router.push({ pathname: '/note', params: { path: node.path } })
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title,
          headerRight: folder
            ? undefined
            : () => (
                <Pressable onPress={confirmUnpair} hitSlop={12}>
                  <Text style={styles.headerAction}>{vault.deviceName ?? 'Aparelho'}</Text>
                </Pressable>
              ),
        }}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <FlatList
        data={nodes}
        keyExtractor={(node) => node.path}
        refreshControl={
          <RefreshControl
            refreshing={vault.syncing}
            onRefresh={() => void syncNow()}
            tintColor={colors.textSecondary}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface1}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {vault.syncing ? 'Baixando o vault…' : 'Nada aqui ainda. Puxe para sincronizar.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={styles.icon}>{item.kind === 'directory' ? '▸' : '·'}</Text>
            <Text
              style={[styles.name, item.kind === 'directory' && styles.folder]}
              numberOfLines={1}
            >
              {item.kind === 'file' ? item.name.replace(/\.md$/i, '') : item.name}
            </Text>
            {item.kind === 'file' && !item.local ? (
              <Text style={styles.meta}>{sizeLabel(item.size)} · baixa ao abrir</Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgApp },
  status: {
    color: colors.textTertiary,
    fontSize: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerAction: { color: colors.textSecondary, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rowPressed: { backgroundColor: colors.surfaceHover },
  icon: { color: colors.textTertiary, width: 12, fontSize: 15 },
  name: { color: colors.textPrimary, fontSize: 16, flex: 1 },
  folder: { fontWeight: '600' },
  meta: { color: colors.textTertiary, fontSize: 12 },
  empty: { color: colors.textTertiary, padding: 20, fontSize: 15 },
})
