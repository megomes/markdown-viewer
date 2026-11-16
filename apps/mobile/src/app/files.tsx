/**
 * The vault's tree, one folder per screen: tapping a folder goes into it, the
 * back gesture comes out. Folders first, then files, as on the desktop.
 *
 * The round button makes a note here. Holding a row offers what the desktop's
 * right click does: rename, move, delete.
 *
 * As on the desktop, the list shows what is written (notes, HTML, Bases) and
 * gathers the rest of the folder in one line; attachments folders and hidden
 * ones stay behind that line too. The first screen opens with the environments,
 * each with its icon and colour.
 */

import { useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  allFolders,
  childrenOf,
  environmentOf,
  createFolder,
  createNote,
  dismissNotice,
  nameProblem,
  relocate,
  removePath,
  syncNow,
  useVault,
  type TreeNode,
} from '../vault/runtime'
import { useUpdates } from '../updates/updater'
import { colors, radius } from '../ui/theme'
import { hasVaultIcon, VaultIcon } from '../ui/VaultIcon'
import { ChevronRight, FileText, Folder, LayoutGrid } from 'lucide-react-native'
import { accentOf } from '@markdown-viewer/core/environments'
import { isAttachmentsFolder } from '@markdown-viewer/core/attachments'
import { viewerOf } from '@markdown-viewer/core/fs'

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

function timeLabel(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const NOTE = /\.(md|markdown)$/i

/** What the person writes, as on the desktop's tree: notes, HTML pages and Bases. */
function isWritten(name: string): boolean {
  const viewer = viewerOf(name)
  return viewer === 'note' || viewer === 'html' || viewer === 'base'
}

/** Kept behind the "mais N" line: material around the notes, not the notes. */
function isAside(node: TreeNode): boolean {
  if (node.name.startsWith('.')) return true
  if (node.kind === 'directory') return isAttachmentsFolder(node.path)
  return !isWritten(node.name)
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

type Dialog =
  | { kind: 'actions'; node: TreeNode }
  | { kind: 'rename'; node: TreeNode }
  | { kind: 'move'; node: TreeNode }
  | { kind: 'folder' }

export default function Files() {
  const { folder = '' } = useLocalSearchParams<{ folder?: string }>()
  const vault = useVault()
  const updates = useUpdates()
  const insets = useSafeAreaInsets()
  const all = useMemo(
    () => childrenOf(vault.files, folder, vault.folders),
    [vault.files, vault.folders, folder],
  )
  // The rest of this folder, shown because its line was tapped.
  const [everything, setEverything] = useState(false)
  const environment = environmentOf(folder, vault.environments)
  const accent = environment ? accentOf(vault.environmentColors[environment]).dark : colors.accent
  // On the first screen the environments are cards of their own, above the rest.
  const cards = folder ? [] : all.filter((node) => vault.environments.includes(node.path))
  const rest = folder ? all : all.filter((node) => !vault.environments.includes(node.path))
  const aside = rest.filter(isAside).length
  const nodes = everything ? rest : rest.filter((node) => !isAside(node))
  const title = folder ? folder.slice(folder.lastIndexOf('/') + 1) : 'Vault'
  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const file of vault.files) {
      const root = file.path.split('/')[0]!
      if (NOTE.test(file.path)) out[root] = (out[root] ?? 0) + 1
    }
    return out
  }, [vault.files])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const waiting =
    vault.pending > 0
      ? vault.pending === 1
        ? '1 alteração esperando envio'
        : `${vault.pending} alterações esperando envio`
      : ''
  const status = vault.syncing
    ? vault.progress
      ? `Sincronizando ${vault.progress.done} de ${vault.progress.total}`
      : 'Sincronizando…'
    : vault.error
      ? waiting
        ? `Sem conexão. ${waiting}: sobe quando a rede voltar.`
        : 'Sem conexão com o servidor. O que já está no aparelho abre normalmente.'
      : waiting || (vault.lastSync ? `Atualizado às ${timeLabel(vault.lastSync)}` : '')

  const open = (node: TreeNode) => {
    if (node.kind === 'directory')
      router.push({ pathname: '/files', params: { folder: node.path } })
    else if (node.fileId) router.push({ pathname: '/note', params: { id: node.fileId } })
  }

  const close = () => {
    setDialog(null)
    setProblem(null)
  }

  const newNote = async () => {
    try {
      const id = await createNote(folder)
      router.push({ pathname: '/note', params: { id, edit: '1' } })
    } catch (error) {
      Alert.alert('Não deu para criar a nota', messageOf(error))
    }
  }

  const startRename = (node: TreeNode) => {
    setTyped(node.kind === 'file' ? node.name.replace(NOTE, '') : node.name)
    setProblem(null)
    setDialog({ kind: 'rename', node })
  }

  const confirmRename = async (node: TreeNode) => {
    const extension = node.kind === 'file' ? (NOTE.exec(node.name)?.[0] ?? '') : ''
    const bad = nameProblem(typed)
    if (bad) return setProblem(bad)
    try {
      await relocate(node.path, (folder ? folder + '/' : '') + typed.trim() + extension)
      close()
    } catch (error) {
      setProblem(messageOf(error))
    }
  }

  const moveTo = async (node: TreeNode, target: string) => {
    try {
      await relocate(node.path, (target ? target + '/' : '') + node.name)
      close()
    } catch (error) {
      setProblem(messageOf(error))
    }
  }

  const confirmFolder = async () => {
    try {
      await createFolder(folder, typed)
      close()
    } catch (error) {
      setProblem(messageOf(error))
    }
  }

  const confirmDelete = (node: TreeNode) => {
    close()
    const inside =
      node.kind === 'directory'
        ? vault.files.filter((file) => file.path.startsWith(node.path + '/')).length
        : 0
    Alert.alert(
      node.kind === 'directory' ? `Apagar a pasta "${node.name}"?` : `Apagar "${node.name}"?`,
      node.kind === 'directory'
        ? inside === 0
          ? 'A pasta está vazia.'
          : `${inside} ${inside === 1 ? 'arquivo sai' : 'arquivos saem'} do vault em todos os aparelhos. No computador eles vão para a lixeira.`
        : 'Sai do vault em todos os aparelhos. No computador vai para a lixeira.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: () =>
            void removePath(node.path).catch((error: unknown) =>
              Alert.alert('Não deu para apagar', messageOf(error)),
            ),
        },
      ],
    )
  }

  const destinations = useMemo(() => {
    if (dialog?.kind !== 'move') return []
    const node = dialog.node
    return ['', ...allFolders(vault.files, vault.folders)].filter(
      (target) =>
        target !== folder &&
        !(
          node.kind === 'directory' &&
          (target === node.path || target.startsWith(node.path + '/'))
        ),
    )
  }, [dialog, vault.files, vault.folders, folder])

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => {
                  setTyped('')
                  setProblem(null)
                  setDialog({ kind: 'folder' })
                }}
                hitSlop={10}
              >
                <Text style={styles.headerAction}>Nova pasta</Text>
              </Pressable>
              {folder ? null : (
                <Pressable onPress={() => router.push('/settings')} hitSlop={10}>
                  <Text style={styles.headerAction}>Ajustes</Text>
                </Pressable>
              )}
            </View>
          ),
        }}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      {vault.notice ? (
        <Pressable style={styles.banner} onPress={dismissNotice}>
          <Text style={styles.bannerText}>{vault.notice} Toque para dispensar.</Text>
        </Pressable>
      ) : null}
      {!folder && updates.update ? (
        <Pressable style={styles.banner} onPress={() => router.push('/settings')}>
          <Text style={styles.bannerText}>
            Versão {updates.update.label} disponível. Toque para atualizar.
          </Text>
        </Pressable>
      ) : null}
      <FlatList
        data={nodes}
        keyExtractor={(node) => node.path}
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          cards.length > 0 ? (
            <View style={styles.cards}>
              {cards.map((card) => {
                const tint = accentOf(vault.environmentColors[card.path]).dark
                const icon = vault.icons[card.path]
                const notes = counts[card.path] ?? 0
                return (
                  <Pressable
                    key={card.path}
                    onPress={() => open(card)}
                    onLongPress={() => setDialog({ kind: 'actions', node: card })}
                    delayLongPress={350}
                    style={({ pressed }) => [styles.card, pressed && styles.rowPressed]}
                  >
                    <View style={[styles.cardTile, { backgroundColor: tint + '33' }]}>
                      {hasVaultIcon(icon) ? (
                        <VaultIcon name={icon} size={22} color={tint} />
                      ) : (
                        <LayoutGrid size={22} color={tint} strokeWidth={1.75} />
                      )}
                    </View>
                    <View style={styles.cardText}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {card.name}
                      </Text>
                      <Text style={styles.meta}>{notes === 1 ? '1 nota' : `${notes} notas`}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.textTertiary} strokeWidth={1.75} />
                  </Pressable>
                )
              })}
              {nodes.length > 0 || aside > 0 ? (
                <Text style={styles.section}>Fora dos ambientes</Text>
              ) : null}
            </View>
          ) : undefined
        }
        ListFooterComponent={
          aside > 0 ? (
            <Pressable
              onPress={() => setEverything(!everything)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.icon} />
              <Text style={styles.others}>
                {everything
                  ? 'mostrar só as notas'
                  : aside === 1
                    ? 'mais 1 item (anexos, PDFs, ocultos)'
                    : `mais ${aside} itens (anexos, PDFs, ocultos)`}
              </Text>
            </Pressable>
          ) : undefined
        }
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
          cards.length > 0 || aside > 0 ? undefined : (
            <Text style={styles.empty}>
              {vault.syncing ? 'Baixando o vault…' : 'Nada aqui ainda. O botão + cria uma nota.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            onLongPress={() => setDialog({ kind: 'actions', node: item })}
            delayLongPress={350}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.icon}>
              {hasVaultIcon(vault.icons[item.path]) ? (
                <VaultIcon
                  name={vault.icons[item.path]!}
                  color={item.kind === 'directory' ? accent : colors.textSecondary}
                />
              ) : item.kind === 'directory' ? (
                <Folder size={18} color={accent} strokeWidth={1.75} />
              ) : (
                <FileText size={18} color={colors.textTertiary} strokeWidth={1.75} />
              )}
            </View>
            <Text
              style={[styles.name, item.kind === 'directory' && styles.folder]}
              numberOfLines={1}
            >
              {item.kind === 'file' ? item.name.replace(/\.md$/i, '') : item.name}
            </Text>
            {item.kind === 'file' && item.pending ? (
              <Text style={styles.meta}>esperando envio</Text>
            ) : item.kind === 'file' && !item.local ? (
              <Text style={styles.meta}>{sizeLabel(item.size)} · baixa ao abrir</Text>
            ) : null}
          </Pressable>
        )}
      />
      <Pressable
        onPress={() => void newNote()}
        accessibilityLabel="Nova nota"
        style={({ pressed }) => [
          styles.fab,
          { bottom: 24 + insets.bottom, backgroundColor: accent },
          pressed && styles.fabPressed,
        ]}
      >
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.scrim} behavior="padding">
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
            {dialog?.kind === 'actions' ? (
              <>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {dialog.node.name}
                </Text>
                <SheetButton label="Renomear" onPress={() => startRename(dialog.node)} />
                <SheetButton
                  label="Mover para…"
                  onPress={() => setDialog({ kind: 'move', node: dialog.node })}
                />
                <SheetButton danger label="Apagar" onPress={() => confirmDelete(dialog.node)} />
              </>
            ) : null}

            {dialog?.kind === 'rename' || dialog?.kind === 'folder' ? (
              <>
                <Text style={styles.sheetTitle}>
                  {dialog.kind === 'folder' ? 'Nova pasta' : 'Renomear'}
                </Text>
                <TextInput
                  style={styles.input}
                  value={typed}
                  onChangeText={(value) => {
                    setTyped(value)
                    setProblem(null)
                  }}
                  autoFocus
                  selectTextOnFocus
                  placeholder="Nome"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={() =>
                    void (dialog.kind === 'folder' ? confirmFolder() : confirmRename(dialog.node))
                  }
                />
                {problem ? <Text style={styles.problem}>{problem}</Text> : null}
                <Pressable
                  style={styles.primary}
                  onPress={() =>
                    void (dialog.kind === 'folder' ? confirmFolder() : confirmRename(dialog.node))
                  }
                >
                  <Text style={styles.primaryText}>
                    {dialog.kind === 'folder' ? 'Criar' : 'Salvar'}
                  </Text>
                </Pressable>
              </>
            ) : null}

            {dialog?.kind === 'move' ? (
              <>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  Mover "{dialog.node.name}" para
                </Text>
                {problem ? <Text style={styles.problem}>{problem}</Text> : null}
                <FlatList
                  style={styles.destinations}
                  data={destinations}
                  keyExtractor={(target) => target || '/'}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => void moveTo(dialog.node, item)}
                      style={({ pressed }) => [styles.destination, pressed && styles.rowPressed]}
                    >
                      <Text
                        style={[
                          styles.destinationText,
                          { paddingLeft: item ? 14 * (item.split('/').length - 1) : 0 },
                        ]}
                        numberOfLines={1}
                      >
                        {item ? item.slice(item.lastIndexOf('/') + 1) : 'Vault (raiz)'}
                      </Text>
                    </Pressable>
                  )}
                />
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function SheetButton({
  label,
  onPress,
  danger = false,
}: {
  label: string
  onPress: () => void
  danger?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sheetButton, pressed && styles.rowPressed]}
    >
      <Text style={[styles.sheetButtonText, danger && styles.danger]}>{label}</Text>
    </Pressable>
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
  headerActions: { flexDirection: 'row', gap: 18 },
  headerAction: { color: colors.textSecondary, fontSize: 14 },
  banner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  bannerText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
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
  icon: { width: 22, alignItems: 'center' },
  others: { color: colors.textTertiary, fontSize: 14, flex: 1 },
  cards: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.borderDefault,
  },
  cardTile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, gap: 2 },
  cardName: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  section: {
    color: colors.textTertiary,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 10,
  },
  name: { color: colors.textPrimary, fontSize: 16, flex: 1 },
  folder: { fontWeight: '600' },
  meta: { color: colors.textTertiary, fontSize: 12 },
  empty: { color: colors.textTertiary, padding: 20, fontSize: 15 },
  fab: {
    position: 'absolute',
    right: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabPressed: { opacity: 0.8 },
  fabText: { color: '#ffffff', fontSize: 30, lineHeight: 34, fontWeight: '400' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    paddingTop: 18,
    paddingHorizontal: 12,
    gap: 4,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  sheetButton: { paddingHorizontal: 10, paddingVertical: 15, borderRadius: radius.md },
  sheetButtonText: { color: colors.textPrimary, fontSize: 17 },
  danger: { color: colors.accentText },
  input: {
    marginHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderDefault,
    backgroundColor: colors.bgContent,
    color: colors.textPrimary,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  problem: { color: colors.accentText, fontSize: 13, paddingHorizontal: 10, paddingTop: 6 },
  primary: {
    marginHorizontal: 6,
    marginTop: 10,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: colors.bgApp, fontWeight: '600', fontSize: 16 },
  destinations: { maxHeight: 380 },
  destination: { paddingHorizontal: 10, paddingVertical: 13, borderRadius: radius.md },
  destinationText: { color: colors.textPrimary, fontSize: 16 },
})
