/**
 * The vault's tree, one folder per screen: tapping a folder goes into it, the
 * back gesture comes out. Folders first, then files, as on the desktop.
 */

import { useMemo } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { childrenOf, syncNow, useVault, type TreeNode } from '../vault/runtime'
import { useUpdates } from '../updates/updater'
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
  const updates = useUpdates()
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
                <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
                  <Text style={styles.headerAction}>Ajustes</Text>
                </Pressable>
              ),
        }}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {!folder && updates.update ? (
        <Pressable style={styles.update} onPress={() => router.push('/settings')}>
          <Text style={styles.updateText}>
            Versão {updates.update.label} disponível. Toque para atualizar.
          </Text>
        </Pressable>
      ) : null}
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
  update: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  updateText: { color: colors.textPrimary, fontSize: 14 },
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
