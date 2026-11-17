import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadSession,
  saveSession,
  type Session,
  type SessionTab,
  type ViewState,
} from '~/app/session'
import {
  DRAFT_BASE,
  isDraft,
  loadDrafts,
  nextDraftName,
  noteTitle,
  saveDrafts,
  type Draft,
} from '~/app/drafts'
import { findPin, isDraftPin, isPinned, type Pin, type PinTarget } from '~/app/pinned'
import { on, send, type LiveDoc } from '~/platform/channel'
import { useDock } from './useDock'
import { onTrayNewNote } from '~/platform/tray'
import { DEFAULTS, LIMITS, useSettings } from '~/app/settings'
import {
  onEntryMoved,
  pathIn,
  tabViewer,
  useWorkspace,
  type Doc,
  type RenameTarget,
  type Tab,
} from '~/app/store'
import { Viewer } from './viewers/Viewer'
import {
  entryId,
  nativeBaseName,
  parentPath,
  type Base,
  type Entry,
} from '@markdown-viewer/core/fs'
import { indexUnder } from '@markdown-viewer/core/base-index'
import type { Heading } from '~/editor/outline'
import { EditorView, type Command } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import {
  insertLink,
  toggleBold,
  toggleCode,
  toggleHighlight,
  toggleItalic,
  toggleStrike,
  toggleTask,
} from '~/editor/commands'
import { exportDocument } from '~/editor/export-html'
import { requestTitleFocus } from '~/editor/title'
import { exportPdf } from '~/editor/export-pdf'
import { fileSystem, isDesktop, platform } from '~/platform'
import { onOpenedPaths } from '~/platform/opened'
import { supportsDirectoryPicker } from '~/platform/fs-browser'
import { EditorPane } from './EditorPane'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog, type DialogChoice } from './Dialog'
import { SHORTCUTS, keyCap, matchShortcut, onApple } from './shortcuts'
import { installAppMenu, menuPlan, type CommandId } from './app-menu'
import { canDrop, draggedEntry, FileTree, type TreeData, type TreeHandlers } from './FileTree'
import { InfoPanel } from './InfoPanel'
import { MeasureGuides } from './MeasureGuides'
import { centreOf, changeTheme } from './theme-transition'
import { UpdateNotice } from './UpdateNotice'
import { Recents } from './Recents'
import { SettingsWindow } from './SettingsWindow'
import { Feedback } from './Feedback'
import { useVaultLinks } from './useVaultLinks'
import { readFolderIcons, saveFolderIcons } from '~/app/folder-icons'
import { iconsAfterMove, type IconMap } from '@markdown-viewer/core/icons'
import { IconPicker } from './IconPicker'
import { readBookmarks, type Bookmark } from '~/app/bookmarks'
import { QuickOpen } from './QuickOpen'
import { SearchPanel } from './SearchPanel'
import { CommentPrompt } from './CommentPrompt'
import { addNoteComment } from '~/app/note-comments'
import { openTarget } from '~/editor/links'
import { Cloud, CloudAlert, CloudOff, MessageSquareText, RefreshCw } from 'lucide-react'
import { SyncPanel } from './SyncPanel'
import { SpaceStrip } from './SpaceStrip'
import { EnvironmentSwitcher, type EnvironmentItem } from './EnvironmentSwitcher'
import {
  colorOf,
  environmentsOf,
  knownEnvironments,
  readEnvironments,
  rememberEnvironments,
  saveEnvironments,
  type EnvironmentsConfig,
} from '~/app/environments'
import { ATTACHMENTS } from '@markdown-viewer/core/environments'
import { attachmentName, attachmentsFolder, embeddedFiles } from '@markdown-viewer/core/attachments'
import { FilesPanel } from './FilesPanel'
import {
  getVault,
  inVault,
  setVault,
  spaceOfTab,
  spacesOf,
  useVault,
  type Space,
  type SpaceId,
} from '~/app/spaces'
import { startSync, useSync } from '~/app/sync'
import { SidebarResizer } from './SidebarResizer'
import { canPrint, printHtml } from './print'
import { installWindowDrag } from './window-drag'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { Tabs } from './Tabs'
import {
  AlertIcon,
  BrandMark,
  CollapseIcon,
  CrosshairIcon,
  FileIcon,
  FilePlusIcon,
  FolderPlusIcon,
  MoreIcon,
  PanelRightIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  SortIcon,
  ThemeIcon,
  UnpinIcon,
} from './icons'
import { useResolvedTheme } from './useTheme'

/**
 * A tab as the session remembers it. The optional halves are set rather than
 * spread so the shape is written in one place and read in one pass.
 */
function toSessionTab(tab: Tab, view: ViewState | undefined): SessionTab {
  const kept: SessionTab = {
    id: tab.id,
    baseId: tab.baseId,
    path: tab.path,
    name: tab.name,
    preview: tab.preview,
  }
  if (tab.label !== undefined) kept.label = tab.label
  if (view) kept.view = view
  return kept
}

/** How long the typing has to stop before the file is written. */
const AUTOSAVE_DELAY = 1500

/**
 * A file inside a folder (the vault or another) saves itself, as in Obsidian:
 * there is no unsaved state there. Loose files and drafts follow the setting.
 */
function inFolder(tab: Tab): boolean {
  return tab.path !== '' && !isDraft(tab)
}

/**
 * Where a new note goes, read from the vault's Obsidian settings so that both
 * apps agree: the root (Obsidian's default), the folder of the open file, or a
 * fixed folder.
 */
async function newFileFolder(baseId: string, current: string): Promise<string> {
  try {
    const loaded = await fileSystem().read(baseId, '.obsidian/app.json')
    const config = JSON.parse(loaded.text) as {
      newFileLocation?: string
      newFileFolderPath?: string
    }
    if (config.newFileLocation === 'current') return current
    if (config.newFileLocation === 'folder') {
      const fixed = (config.newFileFolderPath ?? '').replace(/^\/+|\/+$/g, '')
      if (fixed && (await fileSystem().stat(baseId, fixed))) return fixed
    }
  } catch {
    // no settings, or not Obsidian's: the root
  }
  return ''
}

export function App() {
  const { state, actions } = useWorkspace()
  // A handle for reading the workspace from the console during development.
  if (import.meta.env.DEV) (window as unknown as { workspace?: unknown }).workspace = state
  const { settings, update, reset } = useSettings()
  const theme = useResolvedTheme(settings.themeMode)
  const [sidebarOpen, setSidebarOpen] = useState(() => loadSession()?.sidebarOpen ?? true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [commenting, setCommenting] = useState<{
    baseId: string
    path: string
    title: string
    selected: string
    context: string | null
    section: string
  } | null>(null)
  const sync = useSync()
  // The sync starts with the app, when this device was set up for it.
  useEffect(() => {
    void startSync()
  }, [])
  // The icons of each open base, by path, and the same by entry id for the tree.
  const [iconMaps, setIconMaps] = useState<Record<string, IconMap>>({})
  const folderIcons = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [baseId, icons] of Object.entries(iconMaps)) {
      for (const [path, icon] of Object.entries(icons)) out[entryId(baseId, path)] = icon
    }
    return out
  }, [iconMaps])
  const latestIcons = useRef(iconMaps)
  useEffect(() => {
    latestIcons.current = iconMaps
  })
  const [iconFor, setIconFor] = useState<Entry | null>(null)
  // Which root folders of the vault are environments, and the colour of each.
  const [envConfig, setEnvConfig] = useState<EnvironmentsConfig>({ skip: [], colors: {} })
  const latestEnvConfig = useRef(envConfig)
  useEffect(() => {
    latestEnvConfig.current = envConfig
  })
  const changeEnvironments = useCallback(
    (change: (config: EnvironmentsConfig) => EnvironmentsConfig) => {
      const vaultId = getVault()
      if (!vaultId) return
      const next = change(latestEnvConfig.current)
      if (next === latestEnvConfig.current) return
      latestEnvConfig.current = next
      setEnvConfig(next)
      void saveEnvironments(vaultId, next).catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : String(error)),
      )
    },
    [],
  )
  // An environment's folder renamed keeps its colour, and stays set aside if it was.
  useEffect(
    () =>
      onEntryMoved((baseId, from, to) => {
        if (baseId !== getVault() || from.includes('/') || to.includes('/')) return
        changeEnvironments((config) => {
          if (!(from in config.colors) && !config.skip.includes(from)) return config
          const { [from]: color, ...colors } = config.colors
          return {
            skip: config.skip.map((one) => (one === from ? to : one)),
            colors: color ? { ...colors, [to]: color } : colors,
          }
        })
      }),
    [changeEnvironments],
  )
  /** Changes the icons of a base and writes them to the vault's own file. */
  const changeIcons = useCallback((baseId: string, change: (icons: IconMap) => IconMap) => {
    const before = latestIcons.current[baseId] ?? {}
    const after = change(before)
    if (after === before) return
    latestIcons.current = { ...latestIcons.current, [baseId]: after }
    setIconMaps(latestIcons.current)
    void saveFolderIcons(baseId, after).catch((error: unknown) =>
      setNotice(error instanceof Error ? error.message : String(error)),
    )
  }, [])
  // A folder renamed or moved takes its icon along, and those of what is inside.
  useEffect(
    () =>
      onEntryMoved((baseId, from, to) =>
        changeIcons(baseId, (icons) => iconsAfterMove(icons, from, to)),
      ),
    [changeIcons],
  )
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null)
  const [question, setQuestion] = useState<{
    title: string
    body?: string
    choices: DialogChoice[]
  } | null>(null)

  const restore = actions.restoreSession
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [headings, setHeadings] = useState<Heading[]>([])
  // The keyboard handler is bound once; it reads the headings of the moment.
  const headingsRef = useRef<Heading[]>([])
  useEffect(() => {
    headingsRef.current = headings
  }, [headings])
  const editor = useRef<EditorView | null>(null)
  /**
   * The pinned list and the way to change it, read from the file tree's menu.
   * That menu is built above the dock host and would drag half the file with
   * it if it were moved below, so it reaches both through a reference.
   */
  const latestPins = useRef<Pin[]>([])
  const togglePinRef = useRef<(target: PinTarget) => void>(() => {})
  const unpinRef = useRef<(id: string) => void>(() => {})

  /**
   * When each file in the tree last changed, read only while the tree is ordered
   * by it. The disk is asked when the folders' contents change; a file saved from
   * here brings its own new time, so the note just written moves to the top at once.
   */
  const byModified = settings.treeSort === 'modified-desc' || settings.treeSort === 'modified-asc'
  const [statted, setStatted] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!byModified) return
    let cancelled = false
    const files = Object.values(state.children)
      .flat()
      .filter((entry) => entry.kind === 'file')
    void Promise.all(
      files.map(async (entry) => {
        const version = await fileSystem()
          .stat(entry.baseId, entry.path)
          .catch(() => null)
        return [entry.id, version?.modifiedAt ?? 0] as const
      }),
    ).then((pairs) => {
      if (!cancelled) setStatted(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [byModified, state.children])
  // A string, so that typing (which changes the docs but not their saved time)
  // does not rebuild the tree.
  const savedTimes = byModified
    ? JSON.stringify(
        state.tabs.flatMap((tab) => {
          const doc = state.docs[tab.id]
          return doc && tab.path ? [[entryId(tab.baseId, tab.path), doc.version.modifiedAt]] : []
        }),
      )
    : '[]'
  const modified = useMemo(() => {
    if (!byModified) return undefined
    const times = { ...statted }
    for (const [id, at] of JSON.parse(savedTimes) as [string, number][]) {
      times[id] = Math.max(times[id] ?? 0, at)
    }
    return times
  }, [byModified, statted, savedTimes])

  // Only the slices the tree reads, so that typing in a document does not
  // invalidate it.
  const treeData: TreeData = useMemo(
    () => ({
      children: state.children,
      expanded: state.expanded,
      activeId: state.activeId,
      filter: state.filter,
      icons: folderIcons,
      sort: settings.treeSort,
      modified,
    }),
    [
      state.children,
      state.expanded,
      state.activeId,
      state.filter,
      folderIcons,
      settings.treeSort,
      modified,
    ],
  )

  // Folder icons from Iconize, read once per set of open folders.
  useEffect(() => {
    let cancelled = false
    void Promise.all(state.bases.map((base) => readFolderIcons(base.id))).then((maps) => {
      if (cancelled) return
      setIconMaps(Object.fromEntries(state.bases.map((base, i) => [base.id, maps[i]!])))
    })
    void Promise.all(state.bases.map((base) => readBookmarks(base.id))).then((lists) => {
      if (!cancelled) setBookmarks(lists.flat())
    })
    return () => {
      cancelled = true
    }
  }, [state.bases])

  /**
   * Cursor and scroll per file. It is a reference and not state because nothing
   * on screen depends on it: it exists only to be written into the session.
   */
  const views = useRef<Record<string, ViewState>>({})

  const toggleFolder = useCallback((entry: Entry) => void actions.toggleFolder(entry), [actions])
  const openFile = useCallback(
    (entry: Entry, preview: boolean) => void actions.openFile(entry, preview),
    [actions],
  )

  /**
   * Creating something drops it straight into rename mode, because the name a
   * file is born with is never the one it should keep.
   */
  const createIn = useCallback(
    async (baseId: string, parent: string, kind: 'file' | 'folder') => {
      await actions.expandFolder(baseId, parent)
      const entry = await actions.createEntry(baseId, parent, kind)
      if (!entry) return
      if (kind === 'file') {
        // A note is named in its own title, selected and ready to be typed
        // over, as Obsidian does; the tree's box would lose the focus to the
        // editor opening the note and close before anything was typed.
        requestTitleFocus()
        void actions.openFile(entry, false)
        return
      }
      setRenamingId(entry.id)
    },
    [actions],
  )

  /**
   * Deleting asks first, as Obsidian does: the file goes to the system trash, but
   * a stray click on the last item of a menu should not be what sends it there.
   */
  const confirmTrash = useCallback(
    (entry: Entry) => {
      const folder = entry.kind === 'directory'
      setQuestion({
        title: folder ? 'Excluir pasta' : 'Excluir arquivo',
        body:
          `Tem certeza de que quer excluir “${entry.name}”` +
          (folder ? ' e tudo o que está dentro dela' : '') +
          '? Vai para a lixeira do sistema.',
        choices: [
          { label: 'Cancelar', onSelect: () => setQuestion(null) },
          {
            label: 'Excluir',
            primary: true,
            destructive: true,
            onSelect: () => {
              setQuestion(null)
              void actions.trashEntry(entry).then((trashed) => {
                if (!trashed) return
                // A note that is gone does not stay pinned on the edge, nor do
                // the ones inside a folder that went.
                const gone = (pin: Pin) =>
                  pin.baseId === entry.baseId &&
                  (pin.path === entry.path || pin.path.startsWith(entry.path + '/'))
                for (const pin of latestPins.current.filter(gone)) unpinRef.current(pin.id)
              })
            },
          },
        ],
      })
    },
    [actions],
  )

  /**
   * The tree's menu, in the order and with the names of Obsidian's file explorer,
   * less what this app does not have yet (open to the right, in a new window, move
   * to, bookmark).
   */
  const menuItems = useCallback(
    (entry: Entry): MenuItem[] => {
      const files = fileSystem()
      const copy = (text: string) => void navigator.clipboard.writeText(text)
      const folder = entry.kind === 'directory'
      const system = onApple() ? 'Mostrar no Finder' : 'Mostrar no Explorador de Arquivos'

      const create: MenuItem[] = folder
        ? [
            { label: 'Nova nota', onSelect: () => void createIn(entry.baseId, entry.path, 'file') },
            {
              label: 'Nova pasta',
              onSelect: () => void createIn(entry.baseId, entry.path, 'folder'),
            },
          ]
        : [
            { label: 'Abrir em nova aba', onSelect: () => void actions.openFile(entry, false) },
            {
              label: 'Fazer uma cópia',
              separated: true,
              onSelect: () => void actions.duplicateEntry(entry),
            },
            {
              label: isPinned(latestPins.current, entry.id)
                ? 'Desafixar da barra de notas'
                : 'Fixar na barra de notas',
              onSelect: () =>
                togglePinRef.current({
                  id: entry.id,
                  baseId: entry.baseId,
                  path: entry.path,
                  name: entry.name,
                }),
            },
          ]

      return [
        ...create,
        {
          label: 'Renomear…',
          hint: 'F2',
          separated: folder,
          onSelect: () => setRenamingId(entry.id),
        },
        { label: 'Ícone…', onSelect: () => setIconFor(entry) },
        // A folder at the root of the vault is an environment unless set aside.
        ...(folder &&
        entry.baseId === getVault() &&
        !entry.path.includes('/') &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_') &&
        entry.name !== ATTACHMENTS
          ? [
              latestEnvConfig.current.skip.includes(entry.name)
                ? {
                    label: 'Usar como ambiente',
                    onSelect: () =>
                      changeEnvironments((config) => ({
                        ...config,
                        skip: config.skip.filter((one) => one !== entry.name),
                      })),
                  }
                : {
                    label: 'Não é um ambiente',
                    onSelect: () =>
                      changeEnvironments((config) => ({
                        ...config,
                        skip: [...config.skip, entry.name],
                      })),
                  },
            ]
          : []),
        {
          label: 'Copiar caminho relativo',
          separated: true,
          onSelect: () => copy(entry.path),
        },
        {
          label: 'Copiar caminho completo',
          disabled: !files.can.absolutePath,
          onSelect: () => copy(files.absolutePath(entry.baseId, entry.path) ?? entry.path),
        },
        ...(files.can.reveal
          ? [{ label: system, onSelect: () => void actions.revealEntry(entry) }]
          : []),
        {
          label: 'Excluir',
          hint: onApple() ? '⌘⌫' : 'Ctrl+Del',
          separated: true,
          destructive: true,
          disabled: !files.can.trash,
          onSelect: () => confirmTrash(entry),
        },
      ]
    },
    [actions, createIn, confirmTrash],
  )

  /** The orders of Obsidian's "Change sort order", the chosen one ticked. */
  const sortMenu = (): MenuItem[] =>
    (
      [
        ['name-asc', 'Nome do arquivo (A a Z)'],
        ['name-desc', 'Nome do arquivo (Z a A)'],
        ['modified-desc', 'Data de modificação (mais recente primeiro)'],
        ['modified-asc', 'Data de modificação (mais antiga primeiro)'],
      ] as const
    ).map(([sort, label], i) => ({
      label,
      hint: settings.treeSort === sort ? '✓' : undefined,
      separated: i === 2,
      onSelect: () => update('treeSort', sort),
    }))

  const tree: TreeHandlers = useMemo(
    () => ({
      onToggleFolder: toggleFolder,
      onMove: (entry: Entry, folder: string) => void actions.moveEntry(entry, folder),
      onOpenFile: openFile,
      onContextMenu: (entry, x, y) => setMenu({ items: menuItems(entry), x, y }),
      onStartRename: (entry) => setRenamingId(entry.id),
      onRename: (entry, name) => {
        setRenamingId(null)
        void actions.renameEntry(entry, name)
      },
      onCancelRename: () => setRenamingId(null),
      onTrash: confirmTrash,
    }),
    [actions, confirmTrash, menuItems, openFile, toggleFolder],
  )

  /**
   * What can be done with the file that is open. The export runs from the text
   * in memory rather than from disk, so what leaves is what is on screen, even
   * before autosave has caught up.
   */
  const documentMenu = useCallback((): MenuItem[] => {
    const tab = latestTab.current
    const doc = tab ? latestDoc.current : null
    if (!tab || !doc) return []

    const files = fileSystem()
    const source = { baseId: tab.baseId, path: tab.path }
    const entry: Entry = {
      id: tab.id,
      baseId: tab.baseId,
      path: tab.path,
      name: tab.name,
      kind: 'file' as const,
    }
    const copy = (text: string) => void navigator.clipboard.writeText(text)
    const stem = tab.name.replace(/\.[^.]+$/, '')
    const html = (palette: 'auto' | 'light') =>
      exportDocument(stem, doc.text, source, { theme: palette })

    return [
      {
        label: 'Exportar HTML',
        onSelect: () => {
          void html('auto').then((page) =>
            files.saveAs(stem + '.html', new TextEncoder().encode(page)),
          )
        },
      },
      {
        // Laid out from the syntax tree rather than photographed from a web
        // page, so the text in the file is text: selectable, searchable, and
        // never cut in half by a page break.
        label: 'Exportar PDF',
        hint: '⌘P',
        onSelect: () => {
          setBusy('Gerando o PDF')
          void exportPdf(stem, doc.text, source)
            .then((bytes) => files.saveAs(stem + '.pdf', bytes))
            .catch((error: unknown) =>
              setNotice(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => setBusy(null))
        },
      },
      ...(canPrint()
        ? [{ label: 'Imprimir', onSelect: () => void html('light').then(printHtml) }]
        : []),
      {
        label: 'Copiar caminho',
        separated: true,
        disabled: !files.can.absolutePath,
        onSelect: () => copy(tab.label ?? files.absolutePath(tab.baseId, tab.path) ?? tab.path),
      },
      { label: 'Copiar caminho relativo', onSelect: () => copy(tab.path) },
      ...(files.can.reveal
        ? [{ label: 'Revelar no Finder', onSelect: () => void actions.revealEntry(entry) }]
        : []),
    ]
  }, [actions])

  /** Opens every folder down to the file that is on screen, and scrolls to it. */
  const revealActive = useCallback(async () => {
    const tab = latestTab.current
    if (!tab) return
    await actions.revealPath(tab.baseId, tab.path)
    requestAnimationFrame(() => {
      document
        .querySelector('.tree-row.is-active')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [actions])

  const activeTab = state.tabs.find((tab) => tab.id === state.activeId) ?? null

  // ---- spaces: the vault, other folders, and the files from outside ----
  const vault = useVault()
  // With no vault chosen yet, the sync's folder is it, or the only folder open.
  useEffect(() => {
    if (vault) return
    if (sync.config?.folder) setVault(sync.config.folder)
    else if (state.bases.length === 1) setVault(state.bases[0]!.id)
  }, [vault, sync.config, state.bases])
  // ---- environments: the folders at the root of the vault ----
  const vaultOpen = !!vault && state.bases.some((base) => base.id === vault)
  useEffect(() => {
    if (!vault || !vaultOpen) return
    let cancelled = false
    void readEnvironments(vault).then((config) => {
      if (!cancelled) setEnvConfig(config)
    })
    return () => {
      cancelled = true
    }
  }, [vault, vaultOpen])
  const vaultRoots = vault ? state.children[entryId(vault, '')] : undefined
  const [knownEnvs, setKnownEnvs] = useState(knownEnvironments)
  // Until the root of the vault has been read, the ones of the last run stand.
  const environments = useMemo(() => {
    if (!vault) return []
    if (!vaultRoots) return knownEnvs
    return environmentsOf(vaultRoots, envConfig)
  }, [vault, vaultRoots, envConfig, knownEnvs])
  useEffect(() => {
    if (!vaultRoots) return
    if (environments.join('\n') === knownEnvs.join('\n')) return
    rememberEnvironments(environments)
    setKnownEnvs(environments)
  }, [vaultRoots, environments, knownEnvs])

  const [activeSpace, setActiveSpace] = useState<SpaceId>(() => {
    try {
      return (localStorage.getItem('markdown-viewer.space') as SpaceId | null) ?? 'vault'
    } catch {
      return 'vault'
    }
  })
  const spaces = useMemo(
    () => spacesOf(state.bases, state.tabs, vault, environments),
    [state.bases, state.tabs, vault, environments],
  )
  const space: Space = spaces.find((one) => one.id === activeSpace) ?? spaces[0]!
  const visibleTabs = useMemo(
    () => state.tabs.filter((tab) => spaceOfTab(tab, vault, environments) === space.id),
    [state.tabs, vault, environments, space.id],
  )
  const tabCounts = useMemo(() => {
    const counts: Partial<Record<SpaceId, number>> = {}
    for (const tab of state.tabs) {
      const id = spaceOfTab(tab, vault, environments)
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  }, [state.tabs, vault, environments])
  // Search and quick open look at the space in use: in an environment, at its
  // own notes. Links are resolved against the whole vault, elsewhere.
  const spaceIndexes = useMemo(() => {
    const index = space.baseId ? state.index[space.baseId] : undefined
    if (!space.baseId || !index) return {}
    return { [space.baseId]: space.root ? indexUnder(index, space.root) : index }
  }, [space.baseId, space.root, state.index])
  const environmentItems: EnvironmentItem[] = useMemo(
    () =>
      vault
        ? environments.map((folder) => ({
            folder,
            icon: folderIcons[entryId(vault, folder)] ?? null,
            accent: colorOf(envConfig, folder),
            tabs: tabCounts[`env:${folder}`] ?? 0,
          }))
        : [],
    [vault, environments, folderIcons, envConfig, tabCounts],
  )
  // The favourites of the space in use: in an environment, the ones inside it.
  const spaceBookmarks = useMemo(
    () =>
      bookmarks.filter(
        (bookmark) =>
          bookmark.baseId === space.baseId &&
          (!space.root || bookmark.path.startsWith(space.root + '/')),
      ),
    [bookmarks, space.baseId, space.root],
  )
  const lastActive = useRef<Partial<Record<SpaceId, string | null>>>({})
  const rememberSpace = (id: SpaceId) => {
    setActiveSpace(id)
    try {
      localStorage.setItem('markdown-viewer.space', id)
    } catch {
      // storage blocked
    }
  }
  // Something opened in another space (a file from the system, a link to a
  // folder) brings that space forward.
  //
  // Not while the session is coming back: the restore opens the old tabs one by
  // one, each in front for a moment, and the first vault tab used to pull the
  // app back to the vault from a folder that was open with nothing in it
  // (note #14). Once it is done, the space remembered wins, unless the system
  // handed over a file in the meantime (note #9).
  const [hadSession] = useState(() => loadSession() !== null)
  const settled = useRef(false)
  useEffect(() => {
    if (hadSession && !state.restored) return
    if (!settled.current) {
      settled.current = true
      const asked = state.tabs.find((tab) => tab.id === state.askedOnRestore)
      if (asked) {
        rememberSpace(spaceOfTab(asked, vault, environments))
        return
      }
      if (spaces.some((one) => one.id === activeSpace)) {
        if (activeTab && spaceOfTab(activeTab, vault, environments) === activeSpace) return
        const there = state.tabs.filter(
          (tab) => spaceOfTab(tab, vault, environments) === activeSpace,
        )
        actions.activateTab(there[there.length - 1]?.id ?? null)
        return
      }
    }
    if (!activeTab) return
    const id = spaceOfTab(activeTab, vault, environments)
    if (id !== space.id) rememberSpace(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeId, vault, state.restored, environments])
  const switchSpace = (id: SpaceId) => {
    if (id === space.id) return
    lastActive.current[space.id] = state.activeId
    rememberSpace(id)
    const there = state.tabs.filter((tab) => spaceOfTab(tab, vault, environments) === id)
    const target =
      there.find((tab) => tab.id === lastActive.current[id]) ?? there[there.length - 1] ?? null
    actions.activateTab(target?.id ?? null)
  }
  const spaceRef = useRef({
    id: space.id,
    vault,
    baseId: space.baseId,
    root: space.root,
    environments,
  })
  useEffect(() => {
    spaceRef.current = { id: space.id, vault, baseId: space.baseId, root: space.root, environments }
  })

  // An environment's tree starts at its folder, which has to be read first.
  useEffect(() => {
    if (space.kind === 'env' && space.baseId) void actions.expandFolder(space.baseId, space.root)
  }, [space.kind, space.baseId, space.root, actions])

  // The vault's pill in the strip stands for whatever part of it was in use last.
  const lastVaultSpace = useRef<SpaceId>('vault')
  useEffect(() => {
    if (inVault(space)) lastVaultSpace.current = space.id
  })

  // The colour of the environment in use tints the app's accent.
  const accent = space.kind === 'env' ? colorOf(envConfig, space.root) : null
  useEffect(() => {
    const root = document.documentElement
    if (!accent || accent.id === 'red') {
      delete root.dataset.accent
      return
    }
    root.dataset.accent = accent.id
    root.style.setProperty('--env-accent-dark', accent.dark)
    root.style.setProperty('--env-accent-light', accent.light)
  }, [accent])

  // Alt+1 to Alt+9: the environments, in the order of the list.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1]
      if (!digit) return
      const folder = spaceRef.current.environments[Number(digit) - 1]
      if (!folder) return
      event.preventDefault()
      latestSwitch.current(`env:${folder}`)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  /**
   * A folder just opened, from the "+", the menu, Ctrl+O or the recents, is
   * where the person wants to be: its space comes forward (note #14). Before,
   * the folder joined the strip and the app stayed where it was, which looked
   * like it had gone back to the vault.
   */
  const latestSwitch = useRef(switchSpace)
  useEffect(() => {
    latestSwitch.current = switchSpace
  })
  const openFolder = useCallback(async (opening: Promise<Base | null>) => {
    const base = await opening
    if (!base) return
    latestSwitch.current(base.id === spaceRef.current.vault ? 'vault' : `folder:${base.id}`)
  }, [])

  /**
   * "Nova nota", as in Obsidian: inside a folder there is no draft and no
   * dialog. The file is born on disk, in the place the vault's own settings
   * say (`.obsidian/app.json`, root by default), opens, and waits for its name.
   * Only outside any folder ("Arquivos") is it still a draft.
   */
  const newNote = useCallback(async () => {
    const baseId = spaceRef.current.baseId
    if (!baseId) {
      actions.newNote()
      return
    }
    const tab = latestTab.current
    const root = spaceRef.current.root
    const inside = (path: string) => !root || path === root || path.startsWith(root + '/')
    const current =
      tab && tab.baseId === baseId && tab.path && inside(tab.path) ? parentPath(tab.path) : root
    // What the vault's settings say, unless that is outside the environment in use.
    const wanted = await newFileFolder(baseId, current)
    const folder = inside(wanted) ? wanted : root
    await actions.revealPath(baseId, folder ? folder + '/x' : '')
    await createIn(baseId, folder, 'file')
  }, [actions, createIn])

  useVaultLinks({
    indexes: state.index,
    editor,
    activeTab,
    headings,
    openText: (baseId, path) =>
      void actions.openRecentFile({
        baseId,
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        at: Date.now(),
      }),
    report: setNotice,
  })
  const activeDoc = state.activeId ? (state.docs[state.activeId] ?? null) : null
  // What the open note carries, for the panel on the side.
  const activeText = activeDoc?.text ?? ''
  const activeAttachments = useMemo(() => embeddedFiles(activeText), [activeText])
  // Read from callbacks that must not change identity on every keystroke. The
  // assignment happens after the commit, which is the only moment React allows
  // a ref to be written.
  const latestTab = useRef<Tab | null>(null)
  const latestDoc = useRef<Doc | null>(null)
  // The keyboard handler is bound once and has to read the state of the
  // moment the key was pressed, not of the render that bound it.
  const latestState = useRef(state)
  useEffect(() => {
    // React allows writing a ref from an effect; the rule does not tell that
    // apart from writing one while rendering, which is the real hazard.
    // oxlint-disable-next-line immutability
    latestTab.current = activeTab
    // oxlint-disable-next-line immutability
    latestDoc.current = activeDoc
    // oxlint-disable-next-line immutability
    latestState.current = state
  })

  /** The address of a note, the shape both the pin list and the dock use. */
  const pinTargetOf = useCallback(
    (tab: Tab): PinTarget => ({
      id: tab.id,
      baseId: tab.baseId,
      path: tab.path,
      name: tab.name,
      ...(tab.label === undefined ? {} : { label: tab.label }),
    }),
    [],
  )

  const dock = useDock({
    enabled: settings.dock,
    side: settings.dockSide,
    theme,
    opacity: settings.noteOpacity,
    readOnly: settings.readOnly,

    liveDoc: useCallback((pinId: string) => liveOf(latestState.current.docs[pinId]), []),

    /**
     * The square at the foot of the column writes a new note, the same one
     * "Nova nota" does (note #11): with a vault open, a file born in the vault,
     * where its settings put new notes, saving itself like everything there.
     * Only without a vault is it a draft, which lives in the app until saved.
     */
    onNewNote: useCallback(async (): Promise<PinTarget | null> => {
      const vaultId = spaceRef.current.vault
      if (vaultId && latestState.current.bases.some((base) => base.id === vaultId)) {
        const folder = await newFileFolder(vaultId, '')
        const entry = await actions.createEntry(vaultId, folder, 'file')
        if (entry) {
          void actions.openFile(entry, false)
          return { id: entry.id, baseId: entry.baseId, path: entry.path, name: entry.name }
        }
      }
      const taken = latestState.current.tabs.map((tab: Tab) => tab.name)
      const draft: Draft = {
        id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
        name: nextDraftName(taken),
        text: '',
        at: Date.now(),
      }
      const id = actions.newNote(draft)
      return { id, baseId: DRAFT_BASE, path: draft.id, name: draft.name }
    }, [actions]),

    onOpenInApp: useCallback(
      (pin: Pin) => {
        // A draft is already a tab; it only has to come to the front.
        if (isDraftPin(pin)) {
          actions.activateTab(pin.id)
          return
        }
        void actions.openRecentFile({
          baseId: pin.baseId,
          path: pin.path,
          name: pin.name,
          ...(pin.label === undefined ? {} : { label: pin.label }),
          at: Date.now(),
        })
      },
      [actions],
    ),
  })

  const { pins, renamePin: renameSquare, repointPin } = dock
  const pinnedActive = activeTab !== null && isPinned(pins, activeTab.id)

  /**
   * The same note, typed into or saved from the note on the edge of the
   * screen. The tab here takes the text as it comes, so it is one note in two
   * places and not two copies of it; the note is the one that writes it.
   *
   * A draft still unnamed by hand takes its name from its first line, in the
   * tab strip and on its square at the same time, wherever it was typed.
   */
  useEffect(() => {
    const stops = [
      on('doc:text', ({ id, text }) => {
        if (!latestState.current.docs[id]) return
        actions.sync(id, text)
        const tab = latestState.current.tabs.find((one: Tab) => one.id === id)
        if (tab && isDraft(tab) && !tab.named) {
          const named = noteTitle(text, tab.name)
          actions.renameTab(id, named)
          renameSquare(id, named)
        }
      }),
      on('doc:saved', ({ id, text, version }) => actions.savedElsewhere(id, text, version)),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }, [actions, renameSquare])

  /**
   * Renames a note from its title, here or in the note on the edge of the
   * screen. The square follows, and so does the kept note: a draft by its
   * name, a file by its new address.
   */
  const renameFromTitle = useCallback(
    async (target: RenameTarget, stem: string): Promise<string | null> => {
      const before = liveOf(latestState.current.docs[target.id])
      const outcome = await actions.renameDocument(target, stem)
      if (!outcome.ok) return outcome.message
      if (outcome.id === target.id) {
        renameSquare(target.id, outcome.name)
        return null
      }
      const view = views.current[target.id]
      if (view) views.current = { ...views.current, [outcome.id]: view }
      repointPin(
        target.id,
        {
          id: outcome.id,
          baseId: outcome.baseId ?? target.baseId,
          path: outcome.path ?? target.path,
          name: outcome.name,
          ...(outcome.label === undefined ? {} : { label: outcome.label }),
        },
        before,
      )
      return null
    },
    [actions, renameSquare, repointPin],
  )

  useEffect(
    () =>
      on('note:rename', ({ id, name }) => {
        const pin = findPin(latestPins.current, id)
        if (!pin) return
        void renameFromTitle(pin, name).then((message) => {
          if (message !== null) send('note:rename-failed', { id, message })
        })
      }),
    [renameFromTitle],
  )

  useEffect(() => {
    // oxlint-disable-next-line immutability
    latestPins.current = pins
    // oxlint-disable-next-line immutability
    togglePinRef.current = dock.togglePin
    // oxlint-disable-next-line immutability
    unpinRef.current = dock.unpin
  })

  const togglePinActive = useCallback(() => {
    const tab = latestTab.current
    if (!tab) return
    dock.togglePin(pinTargetOf(tab))
  }, [dock, pinTargetOf])

  // A note asked for from the tray, which may have been the only thing on
  // screen for days.
  useEffect(() => onTrayNewNote(() => actions.newNote()), [actions])

  // Dragging the window by its own interface, on the desktop.
  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    void installWindowDrag().then((off) => {
      if (cancelled) off()
      else stop = off
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  // Reopen last session once, before anything else touches the workspace.
  const previous = useRef<Session | null>(null)
  const restoreStarted = useRef(false)
  useEffect(() => {
    // Development runs effects twice, and reopening a session is not something
    // to do twice.
    if (restoreStarted.current) return
    restoreStarted.current = true

    // The drafts come back first, and on their own: they have nothing on disk
    // to reopen, so they do not depend on any folder still being reachable.
    for (const draft of loadDrafts()) actions.newNote(draft)

    // The vault opens with the app, whatever the last session had (note #2).
    // A vault chosen in the sync panel was never part of a session, so after a
    // restart its space had no tree at all: nothing to click, create or drag.
    // The browser cannot reopen a folder without a click, so it waits for one.
    const openVault = () => {
      const vault = getVault()
      if (!vault || !isDesktop()) return
      void actions.openRecentBase({
        id: vault,
        name: vault.split(/[\\/]/).pop() || vault,
        label: vault,
        at: Date.now(),
      })
    }

    const session = loadSession()
    if (!session) {
      openVault()
      return
    }
    previous.current = session
    views.current = Object.fromEntries(
      session.tabs.flatMap((tab) => (tab.view ? [[tab.id, tab.view]] : [])),
    )
    void restore(session, false).then(openVault)
    // `actions` is stable and asking for it here would re-run the restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore])

  /**
   * Whatever could not be reopened is carried over untouched. Without this, a
   * folder waiting for the person to grant permission again would be erased
   * from the session by the first save, and the offer to reopen it would have
   * nothing left to reopen.
   */
  const persist = useCallback(() => {
    const kept = previous.current
    const waiting = new Set(state.pending)
    const heldTabs = kept ? kept.tabs.filter((tab) => waiting.has(tab.baseId)) : []
    const heldBases = kept ? kept.bases.filter((id) => waiting.has(id)) : []
    const heldFiles = kept ? kept.files.filter((id) => waiting.has(id)) : []
    const heldFolders = kept
      ? kept.expanded.filter((id) => [...waiting].some((base) => pathIn(id, base) !== null))
      : []

    saveSession({
      version: 1,
      bases: [...heldBases, ...state.bases.map((base) => base.id)],
      files: [
        ...heldFiles,
        ...state.tabs.filter((tab) => tab.label !== undefined).map((tab) => tab.baseId),
      ],
      expanded: [...heldFolders, ...Object.keys(state.expanded).filter((id) => state.expanded[id])],
      tabs: [
        ...heldTabs,
        // A draft has nothing on disk to reopen, so it travels in its own
        // store and not in the list of files to read back.
        ...state.tabs
          .filter((tab) => !isDraft(tab))
          .map((tab) => toSessionTab(tab, views.current[tab.id])),
      ],
      activeId: state.activeId ?? kept?.activeId ?? null,
      sidebarOpen,
    })

    // The drafts themselves, text and all, because there is nowhere else they
    // could be read back from.
    saveDrafts(
      state.tabs.filter(isDraft).map((tab) => {
        const draft: Draft = {
          id: tab.path,
          name: tab.name,
          text: state.docs[tab.id]?.text ?? '',
          at: Date.now(),
        }
        if (tab.named) draft.named = true
        return draft
      }),
    )
  }, [
    state.bases,
    state.tabs,
    state.docs,
    state.expanded,
    state.activeId,
    state.pending,
    sidebarOpen,
  ])

  // Writing the session costs a few hundred bytes of ids and paths, so it is
  // written on every change rather than on the way out.
  useEffect(() => {
    if (!state.restored && state.bases.length === 0 && state.tabs.length === 0) return
    persist()
  }, [persist, state.restored, state.bases.length, state.tabs.length])

  const saveActive = useCallback(() => {
    if (state.activeId) void actions.save(state.activeId)
  }, [actions, state.activeId])

  // Autosave: a short pause in the typing writes the file. Off unless it was
  // asked for in the settings, so that by default nothing reaches the disk
  // that the person did not ask to be written.
  useEffect(() => {
    // The text is read so that every keystroke restarts the wait: that is the
    // whole point of the delay, not an accident of the dependency list.
    //
    // A note pinned to the edge of the screen always saves itself, here as in
    // the note that floats out of it: it is one note in two places, and it
    // cannot follow two rules. A draft has no file to save to, and text that
    // came from the other window is that window's to write.
    if (!activeDoc || !activeTab) return
    if (!(settings.autosave || pinnedActive || inFolder(activeTab))) return
    if (isDraft(activeTab) || activeDoc.remote) return
    const { text, dirty, conflict } = activeDoc
    if (text === undefined || !dirty || conflict) return
    const timer = window.setTimeout(saveActive, AUTOSAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [activeDoc, activeTab, pinnedActive, saveActive, settings.autosave])

  /**
   * Noticing what changed behind our back. Three ways, because no single one
   * covers every platform: the desktop watcher, the moment the window comes
   * back, and a slow poll for the browser, which has no watcher at all.
   */
  const POLL = 4000
  const openBases = state.bases.map((base) => base.id).join(',')
  useEffect(() => {
    const check = () => {
      void actions.checkExternalChanges()
      // New, deleted and renamed files show up in the tree (note #15).
      void actions.refreshTree()
    }
    // Read so the watchers are set up again whenever a folder is opened.
    const stop = openBases === '' ? () => {} : actions.watchBases(check)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') check()
    }, POLL)
    return () => {
      stop()
      window.clearInterval(timer)
    }
  }, [actions, openBases])

  // Reading each folder once, to learn what links to what.
  useEffect(() => {
    for (const id of openBases.split(',')) {
      if (id !== '' && !state.index[id]) void actions.indexBase(id)
    }
  }, [actions, openBases, state.index])

  // The window says which file is open, and marks it when there is something
  // unsaved in it.
  useEffect(() => {
    const name = activeTab?.name
    document.title = name ? (activeDoc?.dirty ? '• ' + name : name) : 'Markdown Viewer'
  }, [activeTab?.name, activeDoc?.dirty])

  // Files handed over by the system, from a double click in the file manager
  // or from the command line.
  useEffect(() => {
    return onOpenedPaths((paths) => {
      for (const path of paths) {
        // A file opened from outside every folder is its own base, which is
        // the same shape the history uses for a loose file.
        void actions.openRecentFile({
          baseId: path,
          path: '',
          name: nativeBaseName(path),
          label: path,
          at: Date.now(),
        })
      }
    })
  }, [actions])

  // Saving on blur, and looking for changes made behind our back on focus.
  useEffect(() => {
    const onBlur = () => {
      // A pinned draft has no file yet, and saving it would ask where to put it.
      const pinnedFile = pinnedActive && activeTab !== null && !isDraft(activeTab)
      const folderFile = activeTab !== null && inFolder(activeTab)
      if (settings.autosave || pinnedFile || folderFile) saveActive()
    }
    const onFocus = () => void actions.checkExternalChanges()
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [actions, activeTab, pinnedActive, saveActive, settings.autosave])

  /**
   * Closing a tab that has unsaved text asks first.
   *
   * With the automatic saving off, the text in the editor is the only copy
   * there is, and closing the tab throws it away.
   */
  const closed = useRef<Tab[]>([])
  const closeTab = useCallback(
    (id: string) => {
      const tab = latestState.current.tabs.find((candidate: Tab) => candidate.id === id)
      const drop = () => {
        if (tab) closed.current = [tab, ...closed.current].slice(0, 12)
        // A draft only exists in its tab. Closing it throws the text away, and
        // a row on the edge of the screen pointing at nothing is worse than no
        // row at all, so the pin goes with it. A file outlives its tab, and
        // stays pinned.
        if (tab && isDraft(tab)) unpinRef.current(id)
        actions.closeTab(id)
      }
      if (!tab || !latestState.current.docs[id]?.dirty) {
        drop()
        return
      }
      setQuestion({
        title: 'Fechar ' + tab.name + '?',
        body: 'Há alterações que ainda não foram salvas.',
        choices: [
          {
            label: 'Cancelar',
            onSelect: () => setQuestion(null),
          },
          {
            label: 'Fechar sem salvar',
            destructive: true,
            onSelect: () => {
              setQuestion(null)
              drop()
            },
          },
          {
            label: 'Salvar e fechar',
            primary: true,
            onSelect: () => {
              setQuestion(null)
              void actions.save(id).then(() => {
                // A save that did not take, because the file changed on disk
                // or the folder went away, leaves the tab open: closing it now
                // would throw away the text the save failed to write.
                if (!latestState.current.docs[id]?.dirty) drop()
              })
            },
          },
        ],
      })
    },
    [actions],
  )

  const reopenTab = useCallback(() => {
    const [tab, ...rest] = closed.current
    if (!tab) return
    closed.current = rest
    void actions.openFile(
      { id: tab.id, baseId: tab.baseId, path: tab.path, name: tab.name } as Entry,
      false,
    )
  }, [actions])

  const stepTab = useCallback(
    (delta: number) => {
      const { activeId } = latestState.current
      const tabs = latestState.current.tabs.filter(
        (tab: Tab) =>
          spaceOfTab(tab, spaceRef.current.vault, spaceRef.current.environments) ===
          spaceRef.current.id,
      )
      if (tabs.length === 0) return
      const at = tabs.findIndex((tab: Tab) => tab.id === activeId)
      const next = tabs[(at + delta + tabs.length) % tabs.length]
      if (next) actions.activateTab(next.id)
    },
    [actions],
  )

  const zoom = useCallback(
    (by: number | null) => {
      const { min, max, step } = LIMITS.uiScale
      if (by === null) {
        update('uiScale', DEFAULTS.uiScale)
        return
      }
      const next = Math.round((settings.uiScale + by * step) * 100) / 100
      update('uiScale', Math.min(max, Math.max(min, next)))
    },
    [settings.uiScale, update],
  )

  /**
   * Runs a command once, even when two paths ask for it.
   *
   * The native menu and the keyboard both claim the same keys, and which one
   * swallows a press is the system's business, not ours. A second identical
   * request inside a blink is the same request arriving twice.
   */
  const lastRun = useRef<Map<string, number>>(new Map())
  const once = useCallback((key: string, act: () => void) => {
    const now = Date.now()
    if (now - (lastRun.current.get(key) ?? 0) < 120) return
    lastRun.current.set(key, now)
    act()
  }, [])

  const runCommand = useCallback(
    (hit: CommandId) => {
      const { activeId, tabs, recents } = latestState.current
      const view = editor.current

      if (typeof hit === 'object') {
        if ('tab' in hit) {
          const tab: Tab | undefined = tabs[hit.tab - 1]
          if (tab) actions.activateTab(tab.id)
          return
        }
        if ('recentFile' in hit) {
          const file = recents.files[hit.recentFile]
          if (file) void actions.openRecentFile(file)
          return
        }
        const base = recents.bases[hit.recentBase]
        if (base) void actions.openRecentBase(base)
        return
      }

      const editorCommands: Partial<Record<string, Command>> = {
        undo,
        redo,
        find: openSearchPanel,
        bold: toggleBold,
        italic: toggleItalic,
        code: toggleCode,
        link: insertLink,
        strike: toggleStrike,
        highlight: toggleHighlight,
        task: toggleTask,
      }
      const command = editorCommands[hit]
      if (command) {
        if (!view) return
        once(hit, () => {
          view.focus()
          command(view)
        })
        return
      }

      once(hit, () => {
        switch (hit) {
          case 'save':
            // Saving works wherever the focus is, including inside a table.
            if (activeId) void actions.save(activeId)
            break
          case 'newFile':
            void newNote()
            break
          case 'openBase':
            void openFolder(actions.openBase())
            break
          case 'openFile':
            void actions.openLooseFile()
            break
          case 'closeTab':
            if (activeId) closeTab(activeId)
            break
          case 'reopenTab':
            reopenTab()
            break
          case 'nextTab':
            stepTab(1)
            break
          case 'previousTab':
            stepTab(-1)
            break
          case 'toggleSidebar':
            setSidebarOpen((open) => !open)
            break
          case 'toggleInfo':
            update('infoPanel', !settings.infoPanel)
            break
          case 'togglePin':
            togglePinActive()
            break
          case 'toggleDock':
            update('dock', !settings.dock)
            break
          case 'settings':
            setSettingsOpen((open) => !open)
            break
          case 'feedback':
            setFeedbackOpen((open) => !open)
            break
          case 'quickOpen':
            setQuickOpen((open) => !open)
            break
          case 'searchVault':
            setSearchOpen((open) => !open)
            break
          case 'commentSelection': {
            const view = editor.current
            const tab = latestTab.current
            if (!view || !tab || isDraft(tab)) return
            const { from, to } = view.state.selection.main
            const selected = view.state.doc.sliceString(from, to).trim()
            if (!selected) {
              setNotice('Selecione o trecho que quer comentar.')
              return
            }
            const doc = view.state.doc
            const before = doc.sliceString(Math.max(0, from - 60), from).replace(/\s+/g, ' ')
            const after = doc.sliceString(to, Math.min(doc.length, to + 60)).replace(/\s+/g, ' ')
            const section = headingsRef.current
              .filter((heading) => heading.from <= from)
              .reduce<typeof headingsRef.current>((path, heading) => {
                const kept = path.filter((h) => h.level < heading.level)
                return [...kept, heading]
              }, [])
              .map((heading) => '#'.repeat(heading.level) + ' ' + heading.text)
              .join(' › ')
            setCommenting({
              baseId: tab.baseId,
              path: tab.path,
              title: tab.name,
              selected,
              context:
                (from > 60 ? '...' : '') +
                before +
                '«' +
                selected.replace(/\s+/g, ' ') +
                '»' +
                after,
              section,
            })
            break
          }
          case 'print': {
            // The browser would otherwise print the interface itself.
            if (!activeId) return
            const printing = documentMenu().find((entry) => entry.label.startsWith('Imprimir'))
            printing?.onSelect()
            break
          }
          case 'zoomIn':
            zoom(1)
            break
          case 'zoomOut':
            zoom(-1)
            break
          case 'zoomReset':
            zoom(null)
            break
        }
      })
    },
    [
      actions,
      closeTab,
      documentMenu,
      newNote,
      once,
      openFolder,
      reopenTab,
      settings.dock,
      settings.infoPanel,
      stepTab,
      togglePinActive,
      update,
      zoom,
    ],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hit = matchShortcut(event)
      if (hit === null) return
      event.preventDefault()
      runCommand(hit)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runCommand])

  // The menu the system draws. It is rebuilt when what it offers changes, not
  // on every keystroke: the whole tree crosses to the other side each time.
  const latestRun = useRef(runCommand)
  useEffect(() => {
    // oxlint-disable-next-line immutability
    latestRun.current = runCommand
  })
  const hasDocument = state.tabs.length > 0
  const plan = useMemo(
    () => menuPlan({ recents: state.recents, hasDocument, apple: onApple() }),
    [state.recents, hasDocument],
  )
  // On Windows and Linux the menu lives in the app's own title bar (TitleBar).
  const ownTitleBar = isDesktop() && !onApple()
  useEffect(() => {
    if (!isDesktop() || !onApple()) return
    void installAppMenu(plan, (command) => latestRun.current(command))
      // A menu that did not install leaves the app usable by keyboard, so it
      // is worth a line in the console and not an interruption.
      .catch((error: unknown) => console.error('menu do sistema:', error))
  }, [plan])

  /**
   * Brings a file from outside into the vault: a copy at the vault's root (with
   * a free name), the original to the system trash, and the file opened again
   * from its new place, where the sync now carries it.
   */
  const moveToVault = async (tab: Tab) => {
    if (!vault) return
    if (state.docs[tab.id]?.dirty) {
      setNotice('Salve o arquivo antes de movê-lo para o vault.')
      return
    }
    try {
      const files = fileSystem()
      const bytes = await files.readBinary(tab.baseId, '')
      const dot = tab.name.lastIndexOf('.')
      const stem = dot > 0 ? tab.name.slice(0, dot) : tab.name
      const ext = dot > 0 ? tab.name.slice(dot) : ''
      let name = tab.name
      for (let i = 2; await files.stat(vault, name); i++) name = `${stem} ${i}${ext}`
      await files.write(vault, name, bytes as Uint8Array<ArrayBuffer>)
      if (files.can.trash) await files.trash(tab.baseId, '').catch(() => {})
      actions.closeTab(tab.id)
      await actions.openRecentFile({ baseId: vault, path: name, name, at: Date.now() })
      // The root of the vault reads its children again: the file is new there.
      await actions.expandFolder(vault, '')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Saves a file pasted or dropped into a note as its attachment: in the `Files`
   * folder of the note's environment, under the note's own name and a number.
   */
  const attach = async (tab: Tab, file: File): Promise<string | null> => {
    try {
      const files = fileSystem()
      const folder = attachmentsFolder(tab.path, tab.baseId === vault ? environments : [])
      const fromName = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]
      const fromType = file.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg')
      const known = new Set(
        (state.index[tab.baseId]?.paths ?? []).map((path) =>
          path.slice(path.lastIndexOf('/') + 1).toLowerCase(),
        ),
      )
      // A file that came with a name of its own keeps it, unless that name is
      // one of the clipboard's ("image.png") or is already in the vault.
      const own = file.name && !/^(image|imagem|pasted image)\b/i.test(file.name) ? file.name : ''
      let name = own && !known.has(own.toLowerCase()) ? own : ''
      if (!name) {
        name = attachmentName(tab.name, fromName ?? fromType ?? 'png', (candidate) =>
          known.has(candidate.toLowerCase()),
        )
      }
      await files.createFolder(tab.baseId, folder).catch(() => {})
      while (await files.stat(tab.baseId, folder + '/' + name)) {
        known.add(name.toLowerCase())
        name = attachmentName(tab.name, fromName ?? fromType ?? 'png', (candidate) =>
          known.has(candidate.toLowerCase()),
        )
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      await files.write(tab.baseId, folder + '/' + name, bytes)
      // The embed is written with the name alone: the index has to know the file.
      await actions.indexBase(tab.baseId)
      return name
    } catch (error) {
      setNotice(
        'Não deu para guardar o anexo: ' + (error instanceof Error ? error.message : String(error)),
      )
      return null
    }
  }

  /** Picks the vault's folder: it becomes a base and, from then on, the vault. */
  const chooseVault = async () => {
    const base = await actions.openBase()
    if (base) {
      setVault(base.id)
      switchSpace('vault')
    }
  }

  const dark = theme === 'dark'

  return (
    <div className={'shell' + (sidebarOpen ? '' : ' is-collapsed')}>
      {/* The desktop window has no title bar, so this strip is what it is
          dragged by. Tauri only starts a drag when the press lands on the
          element carrying the attribute, never on a child of it, which is why
          the strip is empty and why the text below repeats the attribute. */}
      <div className="drag-strip" data-drag-window />
      {ownTitleBar && <TitleBar plan={plan} run={(command) => latestRun.current(command)} />}
      <aside className="sidebar">
        <div className="brand" data-drag-window>
          <BrandMark />
          <span className="brand-name">Markdown Viewer</span>
        </div>
        <SpaceStrip
          spaces={spaces.filter((one) => one.kind !== 'env')}
          active={inVault(space) ? 'vault' : space.id}
          counts={tabCounts}
          syncStatus={sync.status}
          onSelect={(id) =>
            switchSpace(
              id === 'vault' && spaces.some((one) => one.id === lastVaultSpace.current)
                ? lastVaultSpace.current
                : id,
            )
          }
          onClose={(closing) => {
            if (closing.baseId && actions.closeBase(closing.baseId)) switchSpace('vault')
          }}
          onAdd={(box) =>
            setMenu({
              x: box.left,
              y: box.bottom + 4,
              items: [
                { label: 'Abrir pasta…', onSelect: () => void openFolder(actions.openBase()) },
                { label: 'Abrir arquivo…', onSelect: () => void actions.openLooseFile() },
              ],
            })
          }
        />

        {inVault(space) && space.baseId && environmentItems.length > 0 && (
          <EnvironmentSwitcher
            environments={environmentItems}
            active={space.kind === 'env' ? space.root : null}
            vaultName={spaces[0]!.name}
            vaultTabs={tabCounts.vault ?? 0}
            shortcut={(index) => (index < 9 ? `Alt+${index + 1}` : null)}
            onSelect={(folder) => switchSpace(folder ? `env:${folder}` : 'vault')}
            onColor={(folder, picked) =>
              changeEnvironments((config) => ({
                ...config,
                colors: { ...config.colors, [folder]: picked.id },
              }))
            }
          />
        )}

        {/* Inside a folder the work is the tree, as in Obsidian; opening another
            folder or a loose file is the "+" of the spaces. These are for
            "Arquivos", where there is no tree. */}
        {space.kind === 'files' && (
          <div className="nav-actions">
            <button type="button" className="nav-action" onClick={() => void newNote()}>
              <FilePlusIcon />
              Nova nota
            </button>
            <button
              type="button"
              className="nav-action"
              onClick={() => void openFolder(actions.openBase())}
            >
              <FolderPlusIcon />
              Abrir pasta
            </button>
            <button
              type="button"
              className="nav-action"
              onClick={() => void actions.openLooseFile()}
            >
              <FileIcon />
              Abrir arquivo
            </button>
          </div>
        )}

        {spaceBookmarks.length > 0 && (
          <div className="bookmarks">
            <p className="bookmarks-title">Favoritos</p>
            {spaceBookmarks.map((bookmark) => (
              <button
                key={bookmark.baseId + bookmark.path}
                type="button"
                className={
                  'bookmark' +
                  (activeTab?.baseId === bookmark.baseId && activeTab.path === bookmark.path
                    ? ' is-active'
                    : '')
                }
                title={bookmark.path}
                onClick={() =>
                  openTarget({ baseId: bookmark.baseId, path: bookmark.path, subpath: null })
                }
              >
                {bookmark.title}
              </button>
            ))}
          </div>
        )}

        {state.bases.length > 0 && (
          <div className="search">
            <SearchIcon size={15} className="search-icon" />
            <input
              className="search-input"
              type="search"
              placeholder="Filtrar arquivos"
              value={state.filter}
              onChange={(event) => actions.setFilter(event.target.value)}
            />
          </div>
        )}

        {state.pending.length > 0 && (
          <button
            type="button"
            className="nav-notice"
            onClick={() => {
              const session = loadSession()
              if (session) void actions.restoreSession(session, true)
            }}
          >
            <AlertIcon size={15} />
            <span>
              Reabrir a sessão anterior
              <span className="nav-notice-hint">
                {state.pending.length === 1
                  ? 'o navegador precisa da sua permissão de novo'
                  : state.pending.length + ' pastas precisam da sua permissão de novo'}
              </span>
            </span>
          </button>
        )}

        {space.kind === 'files' && (
          <FilesPanel
            tabs={visibleTabs}
            activeId={state.activeId}
            canMoveToVault={!!vault && state.bases.some((base) => base.id === vault)}
            onActivate={actions.activateTab}
            onMoveToVault={(tab) => void moveToVault(tab)}
          />
        )}

        <nav className="tree-scroll" role="tree" aria-label="Arquivos">
          {state.bases
            .filter((base) => base.id === space.baseId)
            .map((base) => (
              <section
                className="tree-section"
                key={base.id}
                // Dropped on the empty space of a base: to its root.
                onDragOver={(event) => {
                  if (!canDrop(draggedEntry(), base.id, space.root)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  event.currentTarget.classList.add('is-drop-target')
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    event.currentTarget.classList.remove('is-drop-target')
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.currentTarget.classList.remove('is-drop-target')
                  const moving = draggedEntry()
                  if (canDrop(moving, base.id, space.root))
                    void actions.moveEntry(moving, space.root)
                }}
              >
                {/* The bar of Obsidian's file explorer: new note, new folder, the
                    order, reveal the open file, collapse everything. */}
                <div className="tree-toolbar" role="toolbar" aria-label={base.name}>
                  <button
                    type="button"
                    className="icon-button is-small"
                    aria-label="Nova nota"
                    title="Nova nota"
                    onClick={() => void newNote()}
                  >
                    <FilePlusIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-small"
                    aria-label="Nova pasta"
                    title="Nova pasta"
                    onClick={() => void createIn(base.id, space.root, 'folder')}
                  >
                    <FolderPlusIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-small"
                    aria-label="Mudar a ordem"
                    title="Mudar a ordem"
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect()
                      setMenu({ items: sortMenu(), x: box.left, y: box.bottom + 4 })
                    }}
                  >
                    <SortIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-small"
                    aria-label="Revelar o arquivo aberto"
                    title="Revelar o arquivo aberto"
                    onClick={() => void revealActive()}
                  >
                    <CrosshairIcon size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-small"
                    aria-label="Recolher tudo"
                    title="Recolher tudo"
                    onClick={actions.collapseAll}
                  >
                    <CollapseIcon size={17} />
                  </button>
                </div>
                <FileTree
                  data={treeData}
                  parentId={entryId(base.id, space.root)}
                  depth={0}
                  showAllFiles={settings.showAllFiles}
                  showHidden={settings.showHidden}
                  renamingId={renamingId}
                  {...tree}
                />
              </section>
            ))}
        </nav>

        <div className="sidebar-foot">
          <div className="accent-rule" />
          <Recents
            recents={state.recents}
            openBases={state.bases.map((base) => base.id)}
            open={settings.recentsOpen}
            onToggle={() => update('recentsOpen', !settings.recentsOpen)}
            onOpenFile={(file) => void actions.openRecentFile(file)}
            onOpenBase={(base) => void openFolder(actions.openRecentBase(base))}
            onForgetFile={(file) => actions.forgetRecentFile(file.baseId, file.path)}
            onForgetBase={(base) => actions.forgetRecentBase(base.id)}
            onClear={actions.forgetRecents}
          />
          <div className="sidebar-tools">
            <button
              type="button"
              className="icon-button"
              aria-label="Ajustes"
              title="Ajustes (⌘,)"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <SettingsIcon size={16} />
            </button>
            <button
              type="button"
              className={'icon-button' + (feedbackOpen ? ' is-on' : '')}
              aria-label="Feedback do app"
              title={
                'Feedback do app (' + keyCap(SHORTCUTS.find((one) => one.id === 'feedback')!) + ')'
              }
              aria-pressed={feedbackOpen}
              onClick={() => setFeedbackOpen((open) => !open)}
            >
              <MessageSquareText size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className={
                'icon-button sync-indicator is-' + sync.status + (syncOpen ? ' is-on' : '')
              }
              aria-label="Sincronização"
              title={
                sync.status === 'off'
                  ? 'Sincronização desligada'
                  : sync.status === 'error'
                    ? 'Sincronização parou: ' + (sync.message ?? '')
                    : sync.status === 'syncing'
                      ? 'Sincronizando…'
                      : 'Sincronizado'
              }
              onClick={() => setSyncOpen((open) => !open)}
            >
              {sync.status === 'syncing' ? (
                <RefreshCw size={16} strokeWidth={1.75} />
              ) : sync.status === 'error' ? (
                <CloudAlert size={16} strokeWidth={1.75} />
              ) : sync.status === 'off' || sync.status === 'offline' ? (
                <CloudOff size={16} strokeWidth={1.75} />
              ) : (
                <Cloud size={16} strokeWidth={1.75} />
              )}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={dark ? 'Usar o tema claro' : 'Usar o tema escuro'}
              title={dark ? 'Usar o tema claro' : 'Usar o tema escuro'}
              onClick={(event) =>
                changeTheme(centreOf(event.currentTarget), () =>
                  update('themeMode', dark ? 'light' : 'dark'),
                )
              }
            >
              <ThemeIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Esconder a barra lateral"
              title="Esconder a barra lateral"
              onClick={() => setSidebarOpen(false)}
            >
              <SidebarIcon />
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <SidebarResizer
          width={settings.sidebarWidth}
          onCommit={(width) => update('sidebarWidth', width)}
        />
      )}

      <main className="workspace">
        {/* The reveal button sits in this row and not in the breadcrumb bar, so
            that it stays at the height it was pressed at. */}
        {(visibleTabs.length > 0 || !sidebarOpen) && (
          <div className="workspace-top">
            {!sidebarOpen && (
              <button
                type="button"
                className="icon-button is-reveal"
                aria-label="Mostrar a barra lateral"
                title="Mostrar a barra lateral (⌘\)"
                onClick={() => setSidebarOpen(true)}
              >
                <SidebarIcon />
              </button>
            )}
            <Tabs
              state={{ ...state, tabs: visibleTabs }}
              pins={pins}
              onActivate={actions.activateTab}
              onPin={actions.pinTab}
              onClose={closeTab}
            />
          </div>
        )}

        {/* The bar stays up whenever there is something for it to carry, which
            includes the only way back from a collapsed sidebar. */}
        {activeTab && (
          <header className="topbar" data-drag-window>
            {activeDoc && (
              <span className="save-state" data-state={activeDoc.dirty ? 'dirty' : 'saved'}>
                <span className="save-dot" />
                {activeDoc.dirty ? 'Não salvo' : 'Salvo'}
              </span>
            )}
            {activeDoc && (
              <button
                type="button"
                className={'icon-button' + (pinnedActive ? ' is-on' : '')}
                aria-label={
                  pinnedActive ? 'Desafixar da barra de notas' : 'Fixar na barra de notas'
                }
                title={
                  (pinnedActive ? 'Desafixar da barra de notas' : 'Fixar na barra de notas') +
                  ' (' +
                  keyCap(SHORTCUTS.find((one) => one.id === 'togglePin')!) +
                  ')'
                }
                aria-pressed={pinnedActive}
                onClick={togglePinActive}
              >
                {pinnedActive ? <UnpinIcon size={16} /> : <PinIcon size={16} />}
              </button>
            )}
            {activeDoc && (
              <button
                type="button"
                className={'icon-button' + (settings.infoPanel ? ' is-on' : '')}
                aria-label="Sumário e links"
                title="Sumário e links"
                aria-pressed={settings.infoPanel}
                onClick={() => update('infoPanel', !settings.infoPanel)}
              >
                <PanelRightIcon size={16} />
              </button>
            )}
            {activeDoc && (
              <button
                type="button"
                className="icon-button"
                aria-label="Ações do documento"
                title="Ações do documento"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  setMenu({ items: documentMenu(), x: box.right - 4, y: box.bottom + 4 })
                }}
              >
                <MoreIcon size={16} />
              </button>
            )}
          </header>
        )}

        {activeTab && tabViewer(activeTab) !== 'note' ? (
          <div className="workspace-body">
            <Viewer
              kind={tabViewer(activeTab) as Exclude<ReturnType<typeof tabViewer>, 'note'>}
              baseId={activeTab.baseId}
              path={activeTab.path}
              name={activeTab.name}
              index={state.index[activeTab.baseId]}
              report={setNotice}
            />
          </div>
        ) : activeTab && activeDoc ? (
          <>
            <div className="workspace-body">
              <EditorPane
                key={activeTab.id}
                tab={activeTab}
                doc={activeDoc}
                readOnly={activeDoc.shape.lossy || settings.readOnly}
                getInitialView={() => views.current[activeTab.id]}
                onViewChange={(view) => {
                  views.current = { ...views.current, [activeTab.id]: view }
                  persist()
                }}
                onRename={
                  isLooseTab(activeTab) && !fileSystem().renameLoose
                    ? undefined
                    : (stem) => renameFromTitle(activeTab, stem)
                }
                onAttach={
                  isLooseTab(activeTab) || isDraft(activeTab)
                    ? undefined
                    : (file) => attach(activeTab, file)
                }
                onChange={(text) => {
                  actions.edit(activeTab.id, text)
                  // The note on the edge of the screen, and the glance, show
                  // the same text as it is typed.
                  if (pinnedActive) send('doc:text', { id: activeTab.id, text })
                  // A draft has no file to take its name from, so it takes it
                  // from its own first line, in the tab strip and on its
                  // square at the same time. Until somebody names it by hand.
                  if (isDraft(activeTab) && !activeTab.named) {
                    const named = noteTitle(text, activeTab.name)
                    actions.renameTab(activeTab.id, named)
                    dock.renamePin(activeTab.id, named)
                  }
                }}
                onSave={saveActive}
                onOutline={setHeadings}
                onReady={(view) => {
                  editor.current = view
                }}
              />
              {settings.infoPanel && (
                <SidebarResizer
                  width={settings.infoWidth}
                  onCommit={(next) => update('infoWidth', next)}
                  variable="--info-width"
                  limits={LIMITS.infoWidth}
                  invert
                  label="Largura do painel de sumário e links"
                  restore={DEFAULTS.infoWidth}
                />
              )}
              {settings.infoPanel && (
                <InfoPanel
                  tab={activeTab}
                  attachments={activeAttachments}
                  onFind={(text) => {
                    const view = editor.current
                    if (!view) return
                    const wanted = text.replace(/\.\.\.$/, '')
                    const at = view.state.doc.toString().indexOf(wanted)
                    if (at < 0) {
                      setNotice('Esse trecho não está mais na nota.')
                      return
                    }
                    view.dispatch({
                      selection: { anchor: at, head: at + wanted.length },
                      scrollIntoView: true,
                    })
                    view.focus()
                  }}
                  headings={headings}
                  index={state.index[activeTab.baseId]}
                  onGoTo={(position) => {
                    const view = editor.current
                    if (!view) return
                    view.dispatch({
                      selection: { anchor: position },
                      effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 24 }),
                    })
                    view.focus()
                  }}
                  onOpenPath={(baseId, path) =>
                    void actions.openRecentFile({
                      baseId,
                      path,
                      name: path.slice(path.lastIndexOf('/') + 1),
                      at: Date.now(),
                    })
                  }
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            hasBase={!!space.baseId || space.kind === 'files'}
            vaultMissing={inVault(space) && !space.baseId}
            onOpenBase={() =>
              void (inVault(space) && !space.baseId
                ? chooseVault()
                : openFolder(actions.openBase()))
            }
            onOpenFile={() => void actions.openLooseFile()}
            onNewNote={() => void newNote()}
            onQuickOpen={() => setQuickOpen(true)}
          />
        )}

        {searchOpen && (
          <SearchPanel
            indexes={spaceIndexes}
            onOpen={(baseId, path, line) => {
              setSearchOpen(false)
              openTarget({ baseId, path, subpath: line === null ? null : '@L' + line })
            }}
            onClose={() => setSearchOpen(false)}
          />
        )}

        {feedbackOpen && (
          <Feedback
            screen={feedbackScreen(settingsOpen, activeTab)}
            onClose={() => setFeedbackOpen(false)}
          />
        )}

        <StatusBar
          tab={activeTab}
          doc={activeDoc}
          base={activeTab ? state.bases.find((base) => base.id === activeTab.baseId) : undefined}
          onSave={saveActive}
          onReload={() => state.activeId && void actions.reload(state.activeId)}
        />
      </main>

      {busy && (
        <div className="toast is-busy" role="status">
          <span className="busy-dot" />
          {busy}
        </div>
      )}

      {notice && (
        <div className="toast" role="alert">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>
            fechar
          </button>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {question && (
        <Dialog
          title={question.title}
          body={question.body}
          choices={question.choices}
          onCancel={() => setQuestion(null)}
        />
      )}

      {syncOpen && (
        <SyncPanel
          bases={state.bases}
          activePath={activeTab ? { baseId: activeTab.baseId, path: activeTab.path } : null}
          onVault={(folder) => {
            setVault(folder)
            if (!state.bases.some((base) => base.id === folder)) {
              void actions.openRecentBase({
                id: folder,
                name: folder.split(/[\\/]/).pop() ?? folder,
                label: folder,
                at: Date.now(),
              })
            }
            switchSpace('vault')
          }}
          onClose={() => setSyncOpen(false)}
        />
      )}

      {commenting && (
        <CommentPrompt
          selected={commenting.selected}
          onClose={() => setCommenting(null)}
          onSave={(comment) => {
            const { baseId, path, ...rest } = commenting
            setCommenting(null)
            void addNoteComment(baseId, path, { ...rest, comment }).catch((error: unknown) =>
              setNotice(error instanceof Error ? error.message : String(error)),
            )
          }}
        />
      )}

      {iconFor && (
        <IconPicker
          name={iconFor.name}
          current={iconMaps[iconFor.baseId]?.[iconFor.path] ?? null}
          onClose={() => setIconFor(null)}
          onPick={(icon) => {
            const { baseId, path } = iconFor
            setIconFor(null)
            changeIcons(baseId, (icons) => {
              if (icon) return icons[path] === icon ? icons : { ...icons, [path]: icon }
              if (!(path in icons)) return icons
              const { [path]: _gone, ...rest } = icons
              return rest
            })
          }}
        />
      )}

      {quickOpen && (
        <QuickOpen
          indexes={spaceIndexes}
          onOpen={(baseId, path) => openTarget({ baseId, path, subpath: null })}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsWindow
          settings={settings}
          update={update}
          reset={reset}
          onClose={() => setSettingsOpen(false)}
          onMeasureFocus={setMeasuring}
        />
      )}

      <MeasureGuides active={measuring && activeTab !== null} />

      <UpdateNotice />

      {state.error && (
        <div className="toast" role="alert">
          {state.error}
          <button type="button" onClick={actions.dismissError}>
            fechar
          </button>
        </div>
      )}
    </div>
  )
}

interface EmptyStateProps {
  hasBase: boolean
  vaultMissing: boolean
  onOpenBase: () => void
  onOpenFile: () => void
  onNewNote: () => void
  onQuickOpen: () => void
}

const capOf = (id: string) => {
  const shortcut = SHORTCUTS.find((one) => one.id === id)
  return shortcut ? keyCap(shortcut) : ''
}

function EmptyState({
  hasBase,
  vaultMissing,
  onOpenBase,
  onOpenFile,
  onNewNote,
  onQuickOpen,
}: EmptyStateProps) {
  if (vaultMissing) {
    return (
      <div className="empty">
        <div className="empty-card">
          <p className="empty-title">Escolha a pasta do vault</p>
          <p className="empty-hint">
            É a pasta das suas notas, a mesma que o sync leva para os outros aparelhos. Os arquivos
            ficam onde estão.
          </p>
          <div className="empty-actions">
            <button type="button" className="empty-action" onClick={onOpenBase}>
              Escolher a pasta do vault
            </button>
            <button type="button" className="empty-action is-quiet" onClick={onOpenFile}>
              Abrir um arquivo avulso
            </button>
          </div>
        </div>
      </div>
    )
  }
  // With a folder open, nothing open is a quiet line and two ways in, as in
  // Obsidian, not a card that reads like a button (note #7).
  if (hasBase) {
    return (
      <div className="empty is-quiet">
        <div className="empty-quiet">
          <p className="empty-quiet-title">Nenhum arquivo aberto</p>
          <button type="button" className="empty-link" onClick={onNewNote}>
            Criar nova nota <kbd>{capOf('newFile')}</kbd>
          </button>
          <button type="button" className="empty-link" onClick={onQuickOpen}>
            Ir para um arquivo <kbd>{capOf('quickOpen')}</kbd>
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="empty">
      <div className="empty-card">
        <p className="empty-title">Nenhuma pasta aberta</p>
        <p className="empty-hint">
          Abra uma pasta, ou um arquivo de qualquer lugar do disco. Nada é copiado, os arquivos
          ficam onde estão.
        </p>
        {!hasBase && (
          <div className="empty-actions">
            <button type="button" className="empty-action" onClick={onOpenBase}>
              Abrir pasta
            </button>
            <button type="button" className="empty-action is-quiet" onClick={onOpenFile}>
              Abrir arquivo
            </button>
          </div>
        )}
        {!hasBase && platform() === 'browser' && !supportsDirectoryPicker() && (
          <p className="empty-warn">
            Este navegador não abre uma pasta inteira. Use um navegador Chromium ou o app de
            desktop.
          </p>
        )}
      </div>
    </div>
  )
}

/** What a floating window needs of a note the app has open. */
function liveOf(doc: Doc | undefined): LiveDoc | undefined {
  if (!doc) return undefined
  return { text: doc.text, shape: doc.shape, version: doc.version, dirty: doc.dirty }
}

/**
 * Where a feedback note was written from: the kind of view and the extension of
 * the file in it. Never the path or the name, which stay out of the cloud.
 */
function feedbackScreen(settingsOpen: boolean, tab: Tab | null | undefined): string {
  if (settingsOpen) return 'settings'
  if (!tab) return 'empty'
  const dot = tab.name.lastIndexOf('.')
  return 'editor:' + (dot > 0 ? tab.name.slice(dot).toLowerCase() : 'draft')
}

/** A file opened from outside every folder, which is a base of its own. */
function isLooseTab(tab: Tab): boolean {
  return tab.path === '' && !isDraft(tab)
}
