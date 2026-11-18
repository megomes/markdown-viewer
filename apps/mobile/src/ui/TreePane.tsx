/**
 * The vault as the desktop's sidebar draws it, for the tablet: folders open in
 * place with a chevron, their contents hang from a guide line, folders are blue
 * and notes carry the accent. A tap on a file opens it in the panel beside.
 */

import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronRight, FileText, Folder } from 'lucide-react-native'
import { childrenOf, type TreeNode } from '../vault/runtime'
import type { MirrorFile } from '@markdown-viewer/sync/mirror'
import { hasVaultIcon, VaultIcon } from './VaultIcon'
import { colors, radius } from './theme'

const NOTE = /\.(md|markdown)$/i
const INDENT = 16

interface Row {
  node: TreeNode
  depth: number
}

interface Props {
  files: MirrorFile[]
  folders: string[]
  icons: Record<string, string>
  /** The path of the file open beside, lit in the tree. */
  selected: string | null
  /** Left out of the tree, as on the phone's lists: hidden files and folders. */
  hidden: (node: TreeNode) => boolean
  onOpen: (node: TreeNode) => void
  onLongPress: (node: TreeNode) => void
  header?: React.ReactElement
  footerSpace?: number
}

export function TreePane({
  files,
  folders,
  icons,
  selected,
  hidden,
  onOpen,
  onLongPress,
  header,
  footerSpace = 0,
}: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (folder: string, depth: number) => {
      for (const node of childrenOf(files, folder, folders)) {
        if (hidden(node)) continue
        out.push({ node, depth })
        if (node.kind === 'directory' && open.has(node.path)) walk(node.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [files, folders, open, hidden])

  const toggle = (path: string) =>
    setOpen((now) => {
      const next = new Set(now)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.node.path}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingBottom: footerSpace, paddingHorizontal: 8 }}
      renderItem={({ item: { node, depth } }) => {
        const isFolder = node.kind === 'directory'
        const active = node.path === selected
        const icon = icons[node.path]
        return (
          <View style={styles.line}>
            {/* The guide lines of the folders this row hangs from. */}
            {Array.from({ length: depth }, (_, i) => (
              <View key={i} style={styles.guide} />
            ))}
            <Pressable
              onPress={() => (isFolder ? toggle(node.path) : onOpen(node))}
              onLongPress={() => onLongPress(node)}
              delayLongPress={350}
              style={({ pressed }) => [
                styles.row,
                active && styles.active,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.twisty, open.has(node.path) && styles.twistyOpen]}>
                {isFolder ? (
                  <ChevronRight size={14} color={colors.textDisabled} strokeWidth={2} />
                ) : null}
              </View>
              {hasVaultIcon(icon) ? (
                <VaultIcon
                  name={icon!}
                  size={16}
                  color={isFolder ? colors.toneBlue : colors.textSecondary}
                />
              ) : isFolder ? (
                <Folder size={16} color={colors.toneBlue} strokeWidth={1.75} />
              ) : (
                <FileText
                  size={16}
                  color={NOTE.test(node.name) ? colors.accentText : colors.textTertiary}
                  strokeWidth={1.75}
                />
              )}
              <Text style={[styles.name, active && styles.nameActive]} numberOfLines={1}>
                {node.kind === 'file' ? node.name.replace(NOTE, '') : node.name}
              </Text>
            </Pressable>
          </View>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row' },
  guide: {
    width: INDENT,
    marginLeft: 6,
    marginRight: -6,
    borderLeftWidth: 1,
    borderLeftColor: colors.borderSubtle,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  active: { backgroundColor: colors.surface3 },
  pressed: { backgroundColor: colors.surface2 },
  twisty: { width: 14, alignItems: 'center' },
  twistyOpen: { transform: [{ rotate: '90deg' }] },
  name: { flex: 1, color: colors.textSecondary, fontSize: 14.5 },
  nameActive: { color: colors.textPrimary },
})
