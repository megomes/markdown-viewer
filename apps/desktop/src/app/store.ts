import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { fileSystem } from '~/platform'
import {
  buildIndex,
  EMPTY_INDEX,
  resolverOf,
  type BaseIndex,
} from '@markdown-viewer/core/base-index'
import { rewriteLinks } from '@markdown-viewer/core/rewrite'
import {
  clearRecents,
  forgetBase,
  forgetFile,
  loadRecents,
  rememberBase,
  rememberFile,
  type RecentBase,
  type RecentFile,
  type Recents,
} from './recents'
import { byDepth, restoreMayChooseActive, type Session, type SessionTab } from './session'
import { DRAFT_BASE, isDraft, nextDraftName, type Draft } from './drafts'
import {
  baseName,
  entryId,
  isPlainText,
  viewerOf,
  type Viewer,
  joinPath,
  parentPath,
  type Base,
  type Entry,
  type FileVersion,
  nativeBaseName,
  withoutExtension,
} from '@markdown-viewer/core/fs'
import { encode, type TextShape } from '@markdown-viewer/core/text'
import { send } from '~/platform/channel'

/** The shape a note is born with: plain UTF-8, newline endings, no BOM. */
const DRAFT_SHAPE: TextShape = { eol: '\n', bom: false, encoding: 'utf-8', lossy: false }

export interface Tab {
  /** Same as the entry id, so a file is never open twice. */
  id: string
  baseId: string
  path: string
  name: string
  /** A preview tab shows in italic and is replaced by the next single click. */
  preview: boolean
  /** Full path of a file opened outside every base. */
  label?: string
  /**
   * A draft somebody named by hand. It stops taking its name from its own
   * first line, because the name it was given is the one they want.
   */
  named?: boolean
}

export interface Doc {
  text: string
  shape: TextShape
  version: FileVersion
  dirty: boolean
  /** Set when the file changed on disk while we had unsaved edits. */
  conflict: boolean
  /** Set when the file is no longer on disk. */
  gone: boolean
  /**
   * Counts the times the text was replaced from outside the editor, by
   * another window typing into the same note. The editor takes the text in
   * when this moves, dirty or not.
   */
  rev?: number
  /**
   * The unsaved text came from another window, which is the one that will
   * write it. Saving it from here too would be two writes racing for the file.
   */
  remote?: boolean
}

/** The note being renamed: a tab, or a pinned file that is not open in one. */
export interface RenameTarget {
  id: string
  baseId: string
  path: string
  name: string
}

/** What renaming a note from its title came to. */
export type RenameOutcome =
  | {
      ok: true
      /** The note's id afterwards, which moves with the path of a file. */
      id: string
      name: string
      path?: string
      baseId?: string
      label?: string
    }
  | { ok: false; message: string }

export interface State {
  bases: Base[]
  /** Children by entry id of the folder. */
  children: Record<string, Entry[]>
  expanded: Record<string, boolean>
  tabs: Tab[]
  activeId: string | null
  docs: Record<string, Doc>
  filter: string
  error: string | null
  /** What has been opened before, folders and files. */
  recents: Recents
  /** Links and titles of each open base, built in the background. */
  index: Record<string, BaseIndex>
  /** Bases from last session that the browser will only reopen after a click. */
  pending: string[]
  /** False until the attempt to reopen last session has finished. */
  restored: boolean
  /**
   * The tab of a file the system handed over while the session was coming back
   * (note #9). Its space is the one to show, not the one remembered.
   */
  askedOnRestore: string | null
}

type Action =
  | { type: 'base/added'; base: Base }
  | { type: 'base/removed'; id: string }
  | { type: 'children/loaded'; id: string; entries: Entry[] }
  | { type: 'folder/toggled'; id: string }
  | { type: 'tab/opened'; tab: Tab }
  | { type: 'tab/pinned'; id: string }
  | { type: 'tab/renamed'; id: string; name: string; named?: boolean }
  | { type: 'tab/closed'; id: string }
  | { type: 'tab/activated'; id: string | null }
  | { type: 'doc/loaded'; id: string; doc: Doc }
  | { type: 'doc/edited'; id: string; text: string }
  | { type: 'doc/synced'; id: string; text: string }
  | { type: 'doc/saved'; id: string; version: FileVersion }
  | { type: 'doc/saved-elsewhere'; id: string; text: string; version: FileVersion }
  | { type: 'doc/conflicted'; id: string }
  | { type: 'doc/vanished'; id: string }
  | { type: 'filter/set'; value: string }
  | { type: 'error/set'; message: string | null }
  | { type: 'session/restored'; pending: string[]; asked: string | null }
  | { type: 'folder/expanded'; id: string }
  | { type: 'entry/moved'; baseId: string; from: string; to: string }
  | { type: 'loose/moved'; from: string; to: string }
  | { type: 'entry/removed'; baseId: string; path: string }
  | { type: 'folders/collapsed' }
  | { type: 'recents/set'; recents: Recents }
  | { type: 'index/progress'; baseId: string; index: BaseIndex }

const initialState: State = {
  bases: [],
  children: {},
  expanded: {},
  tabs: [],
  activeId: null,
  docs: {},
  filter: '',
  error: null,
  recents: loadRecents(),
  index: {},
  pending: [],
  restored: false,
  askedOnRestore: null,
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'base/added': {
      // Opening the same folder twice, or restoring one that is already open,
      // must not draw the tree twice.
      const known = state.bases.some((base) => base.id === action.base.id)
      if (known) return state
      return { ...state, bases: [...state.bases, action.base] }
    }

    case 'children/loaded':
      return { ...state, children: { ...state.children, [action.id]: action.entries } }

    case 'folder/toggled':
      return { ...state, expanded: { ...state.expanded, [action.id]: !state.expanded[action.id] } }

    case 'tab/opened': {
      const existing = state.tabs.find((tab) => tab.id === action.tab.id)
      if (existing) {
        // Reopening a preview tab as a pinned one keeps its place in the strip.
        const tabs = action.tab.preview
          ? state.tabs
          : state.tabs.map((tab) => (tab.id === action.tab.id ? { ...tab, preview: false } : tab))
        return { ...state, tabs, activeId: action.tab.id }
      }
      const withoutPreview = action.tab.preview
        ? state.tabs.filter((tab) => !tab.preview || state.docs[tab.id]?.dirty)
        : state.tabs
      return { ...state, tabs: [...withoutPreview, action.tab], activeId: action.tab.id }
    }

    case 'tab/pinned':
      return {
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, preview: false } : tab)),
      }

    /**
     * Only a draft is renamed this way: by its own first line, or by hand from
     * its title. A file is renamed on disk, by `entry/moved`, because its name
     * is the name of something that exists.
     *
     * A name given by hand sticks. The first line no longer reaches it.
     */
    case 'tab/renamed': {
      const tab = state.tabs.find((candidate) => candidate.id === action.id)
      if (!tab || !isDraft(tab)) return state
      if (tab.named && !action.named) return state
      if (tab.name === action.name && (tab.named || !action.named)) return state
      return {
        ...state,
        tabs: state.tabs.map((one) =>
          one.id === action.id
            ? { ...one, name: action.name, ...(action.named ? { named: true } : {}) }
            : one,
        ),
      }
    }

    case 'tab/closed': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id)
      const tabs = state.tabs.filter((tab) => tab.id !== action.id)
      const docs = { ...state.docs }
      delete docs[action.id]
      // The next tab is a neighbour from the same place (the same folder, the
      // loose files, the drafts), so closing a tab never jumps to another space.
      const closing = state.tabs[index]
      const group = (tab: Tab) =>
        tab.path === '' && !isDraft(tab) ? 'loose' : isDraft(tab) ? 'draft' : tab.baseId
      const kin = closing ? tabs.filter((tab) => group(tab) === group(closing)) : tabs
      const before = closing
        ? state.tabs.slice(0, index).filter((tab) => kin.includes(tab)).length
        : index
      const fallback = kin[Math.min(before, kin.length - 1)]?.id ?? null
      return {
        ...state,
        tabs,
        docs,
        activeId: state.activeId === action.id ? fallback : state.activeId,
      }
    }

    case 'tab/activated':
      return { ...state, activeId: action.id }

    // A folder closed from its space: its tabs go with it. The files stay on disk.
    case 'base/removed': {
      const tabs = state.tabs.filter((tab) => tab.baseId !== action.id)
      const docs = { ...state.docs }
      for (const tab of state.tabs) if (tab.baseId === action.id) delete docs[tab.id]
      const index = { ...state.index }
      delete index[action.id]
      return {
        ...state,
        bases: state.bases.filter((base) => base.id !== action.id),
        tabs,
        docs,
        index,
        activeId: tabs.some((tab) => tab.id === state.activeId) ? state.activeId : null,
      }
    }

    case 'doc/loaded':
      return { ...state, docs: { ...state.docs, [action.id]: action.doc } }

    case 'doc/edited': {
      const doc = state.docs[action.id]
      if (!doc || doc.text === action.text) return state
      return {
        ...state,
        // Typing pins the tab. Without this, a preview tab the person has
        // already written in would be thrown away by the next single click.
        tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, preview: false } : tab)),
        docs: {
          ...state.docs,
          [action.id]: { ...doc, text: action.text, dirty: true, remote: false },
        },
      }
    }

    case 'doc/synced': {
      const doc = state.docs[action.id]
      if (!doc || doc.text === action.text) return state
      return {
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, preview: false } : tab)),
        docs: {
          ...state.docs,
          [action.id]: {
            ...doc,
            text: action.text,
            dirty: true,
            remote: true,
            rev: (doc.rev ?? 0) + 1,
          },
        },
      }
    }

    /**
     * Another window wrote this note. The stamp is taken either way, so that
     * the next save from here does not mistake that write for somebody
     * else's; the dot goes only if what was written is what is here.
     */
    case 'doc/saved-elsewhere': {
      const doc = state.docs[action.id]
      if (!doc) return state
      const same = doc.text === action.text
      return {
        ...state,
        docs: {
          ...state.docs,
          [action.id]: {
            ...doc,
            version: action.version,
            ...(same ? { dirty: false, conflict: false, remote: false } : {}),
          },
        },
      }
    }

    case 'doc/saved': {
      const doc = state.docs[action.id]
      if (!doc) return state
      return {
        ...state,
        docs: {
          ...state.docs,
          [action.id]: {
            ...doc,
            dirty: false,
            conflict: false,
            remote: false,
            version: action.version,
          },
        },
      }
    }

    case 'doc/conflicted': {
      const doc = state.docs[action.id]
      if (!doc) return state
      return { ...state, docs: { ...state.docs, [action.id]: { ...doc, conflict: true } } }
    }

    case 'doc/vanished': {
      const doc = state.docs[action.id]
      if (!doc || doc.gone) return state
      // The text stays in the editor. Saving it puts the file back.
      return { ...state, docs: { ...state.docs, [action.id]: { ...doc, gone: true, dirty: true } } }
    }

    case 'filter/set':
      return { ...state, filter: action.value }

    case 'error/set':
      return { ...state, error: action.message }

    case 'session/restored':
      return { ...state, restored: true, pending: action.pending, askedOnRestore: action.asked }

    case 'index/progress':
      return { ...state, index: { ...state.index, [action.baseId]: action.index } }

    case 'recents/set':
      return { ...state, recents: action.recents }

    case 'folders/collapsed':
      return { ...state, expanded: {} }

    case 'folder/expanded':
      return { ...state, expanded: { ...state.expanded, [action.id]: true } }

    case 'entry/moved': {
      // A rename moves the entry and everything under it, so every open tab,
      // every loaded document and every expanded folder has to follow.
      const under = (path: string) => path === action.from || path.startsWith(action.from + '/')
      const moved = (path: string) => action.to + path.slice(action.from.length)

      const docs: Record<string, Doc> = {}
      for (const [id, doc] of Object.entries(state.docs)) {
        docs[remapId(id, action.baseId, under, moved)] = doc
      }

      const expanded: Record<string, boolean> = {}
      for (const [id, open] of Object.entries(state.expanded)) {
        expanded[remapId(id, action.baseId, under, moved)] = open
      }

      const tabs = state.tabs.map((tab) => {
        if (tab.baseId !== action.baseId || !under(tab.path)) return tab
        const path = moved(tab.path)
        return { ...tab, path, name: baseName(path), id: entryId(tab.baseId, path) }
      })

      const activeId =
        state.activeId === null ? null : remapId(state.activeId, action.baseId, under, moved)

      return { ...state, docs, expanded, tabs, activeId }
    }

    /**
     * A loose file renamed. It is its own base, so the base id is the path,
     * and the tab and the document follow it to the new one.
     */
    case 'loose/moved': {
      const from = entryId(action.from, '')
      const to = entryId(action.to, '')
      const docs = { ...state.docs }
      if (docs[from]) {
        docs[to] = docs[from]
        delete docs[from]
      }
      const tabs = state.tabs.map((tab) =>
        tab.id === from
          ? { ...tab, id: to, baseId: action.to, name: nativeBaseName(action.to), label: action.to }
          : tab,
      )
      return { ...state, docs, tabs, activeId: state.activeId === from ? to : state.activeId }
    }

    case 'entry/removed': {
      const under = (path: string) => path === action.path || path.startsWith(action.path + '/')
      const gone = (tab: Tab) => tab.baseId === action.baseId && under(tab.path)

      const docs = { ...state.docs }
      for (const tab of state.tabs.filter(gone)) delete docs[tab.id]
      const tabs = state.tabs.filter((tab) => !gone(tab))

      return {
        ...state,
        docs,
        tabs,
        activeId: tabs.some((tab) => tab.id === state.activeId)
          ? state.activeId
          : (tabs[tabs.length - 1]?.id ?? null),
      }
    }
  }
}

type MoveListener = (baseId: string, from: string, to: string) => void
const moveListeners = new Set<MoveListener>()

/**
 * Told each time a file or a folder went from one path to another, renamed or
 * moved, here or from a note's own title. For what is kept by path outside the
 * workspace: the icons.
 */
export function onEntryMoved(listener: MoveListener): () => void {
  moveListeners.add(listener)
  return () => moveListeners.delete(listener)
}

function entryMoved(baseId: string, from: string, to: string): void {
  for (const listener of moveListeners) listener(baseId, from, to)
}

export function useWorkspace() {
  const [state, dispatch] = useReducer(reducer, initialState)

  /**
   * The actions read the state through this reference rather than through the
   * closure, so that none of them changes identity between renders. Without it
   * every keystroke hands the file tree and the tab strip a new set of
   * callbacks, and they all render again for nothing.
   */
  const latest = useRef(state)
  /**
   * A file asked for while the session is still coming back (the system opening
   * the app with a double click on a .md). The restore reopens the old tabs after
   * it and used to bring the old active one forward, over the file just asked for
   * (note #9); it brings this one forward instead.
   */
  const chosen = useRef<string | null>(null)
  const restoring = useRef(false)
  useEffect(() => {
    latest.current = state
  })

  const report = useCallback((error: unknown) => {
    dispatch({ type: 'error/set', message: error instanceof Error ? error.message : String(error) })
  }, [])

  const loadChildren = useCallback(
    async (baseId: string, path: string) => {
      try {
        const entries = await fileSystem().list(baseId, path)
        dispatch({ type: 'children/loaded', id: entryId(baseId, path), entries })
      } catch (error) {
        report(error)
      }
    },
    [report],
  )

  const openBase = useCallback(async (): Promise<Base | null> => {
    try {
      const base = await fileSystem().openBase()
      if (!base) return null
      dispatch({ type: 'recents/set', recents: rememberBase(base) })
      dispatch({ type: 'base/added', base })
      await loadChildren(base.id, '')
      return base
    } catch (error) {
      report(error)
      return null
    }
  }, [loadChildren, report])

  const toggleFolder = useCallback(
    async (entry: Entry) => {
      dispatch({ type: 'folder/toggled', id: entry.id })
      if (!latest.current.children[entry.id]) await loadChildren(entry.baseId, entry.path)
    },
    [loadChildren],
  )

  /**
   * A file picked from anywhere on disk. It gets a base of its own, does not
   * enter the tree, and opens pinned: nobody opens a file through the system
   * dialog by accident.
   */
  const openLooseFile = useCallback(async () => {
    try {
      const loose = await fileSystem().openFile()
      if (!loose) return

      const id = entryId(loose.baseId, '')
      dispatch({
        type: 'tab/opened',
        tab: {
          id,
          baseId: loose.baseId,
          path: '',
          name: loose.name,
          label: loose.label,
          preview: false,
        },
      })

      dispatch({
        type: 'recents/set',
        recents: rememberFile({
          baseId: loose.baseId,
          path: '',
          name: loose.name,
          label: loose.label,
        }),
      })
      if (latest.current.docs[id]) return
      const loaded = await fileSystem().read(loose.baseId, '')
      dispatch({
        type: 'doc/loaded',
        id,
        doc: { ...loaded, dirty: false, conflict: false, gone: false },
      })
    } catch (error) {
      report(error)
    }
  }, [report])

  const openFile = useCallback(
    async (entry: Entry, preview: boolean) => {
      dispatch({
        type: 'tab/opened',
        tab: { id: entry.id, baseId: entry.baseId, path: entry.path, name: entry.name, preview },
      })
      dispatch({
        type: 'recents/set',
        recents: rememberFile({ baseId: entry.baseId, path: entry.path, name: entry.name }),
      })
      if (latest.current.docs[entry.id] || viewerOf(entry.name) !== 'note') return
      try {
        const loaded = await fileSystem().read(entry.baseId, entry.path)
        dispatch({
          type: 'doc/loaded',
          id: entry.id,
          doc: { ...loaded, dirty: false, conflict: false, gone: false },
        })
      } catch (error) {
        report(error)
      }
    },
    [report],
  )

  /**
   * Opening a recent file is defined further down, and saving a draft needs
   * it, so it is reached through a reference rather than by moving either one.
   */
  const openRecent = useRef<((file: RecentFile) => Promise<void>) | null>(null)

  /**
   * Opens a note that exists only in the app.
   *
   * No dialog, no file, nothing on disk. It becomes a file the first time it
   * is saved, and only then is the person asked where it goes.
   */
  const newNote = useCallback((restoring?: Draft) => {
    const taken = latest.current.tabs.map((tab) => tab.name)
    const draft: Draft = restoring ?? {
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
      name: nextDraftName(taken),
      text: '',
      at: Date.now(),
    }
    const id = entryId(DRAFT_BASE, draft.id)
    dispatch({
      type: 'tab/opened',
      tab: {
        id,
        baseId: DRAFT_BASE,
        path: draft.id,
        name: draft.name,
        preview: false,
        ...(draft.named ? { named: true } : {}),
      },
    })
    dispatch({
      type: 'doc/loaded',
      id,
      doc: {
        text: draft.text,
        shape: DRAFT_SHAPE,
        version: { size: 0, modifiedAt: 0 },
        // Never clean: a draft is unsaved by definition, and the dot on the
        // tab is what says so.
        dirty: true,
        conflict: false,
        gone: false,
      },
    })
    return id
  }, [])

  /**
   * Saving a draft is the moment it stops being one: the person says where it
   * goes, the bytes are written there, and the tab is replaced by the file.
   */
  const saveDraftAs = useCallback(
    async (id: string) => {
      const tab = latest.current.tabs.find((candidate) => candidate.id === id)
      const doc = latest.current.docs[id]
      if (!tab || !doc) return
      try {
        const suggested = tab.name.endsWith('.md') ? tab.name : tab.name + '.md'
        const target = await fileSystem().saveAs(suggested, encode(doc.text, doc.shape))
        if (!target) return
        dispatch({ type: 'tab/closed', id })
        await openRecent.current?.({
          baseId: target,
          path: '',
          name: nativeBaseName(target),
          label: target,
          at: Date.now(),
        })
      } catch (error) {
        report(error)
      }
    },
    [report],
  )

  const save = useCallback(
    async (id: string) => {
      const tab = latest.current.tabs.find((candidate) => candidate.id === id)
      const doc = latest.current.docs[id]
      if (!tab || !doc || !doc.dirty) return
      if (isDraft(tab)) {
        await saveDraftAs(id)
        return
      }
      if (doc.shape.lossy) {
        report(
          new Error(
            'Arquivo não é UTF-8. Aberto somente para leitura para não corromper os bytes.',
          ),
        )
        return
      }
      try {
        const onDisk = await fileSystem().stat(tab.baseId, tab.path)
        if (onDisk && onDisk.modifiedAt > doc.version.modifiedAt) {
          dispatch({ type: 'doc/conflicted', id })
          return
        }
        const version = await fileSystem().write(tab.baseId, tab.path, encode(doc.text, doc.shape))
        dispatch({ type: 'doc/saved', id, version })
        // The same note may be open on the edge of the screen, and it should
        // stop calling itself unsaved at the same moment this tab does.
        send('doc:saved', { id, text: doc.text, version })
      } catch (error) {
        report(error)
      }
    },
    [report, saveDraftAs],
  )

  /** Pulls the file from disk again, throwing away what is in the editor. */
  const reload = useCallback(
    async (id: string) => {
      const tab = latest.current.tabs.find((candidate) => candidate.id === id)
      if (!tab) return
      try {
        const loaded = await fileSystem().read(tab.baseId, tab.path)
        dispatch({
          type: 'doc/loaded',
          id,
          doc: { ...loaded, dirty: false, conflict: false, gone: false },
        })
      } catch (error) {
        report(error)
      }
    },
    [report],
  )

  /**
   * Notices files that changed behind our back. A clean document reloads on its
   * own; a dirty one is flagged and the person decides, so no text is lost.
   */
  const checkExternalChanges = useCallback(async () => {
    for (const tab of latest.current.tabs) {
      const doc = latest.current.docs[tab.id]
      // A draft has no file, so there is nothing on disk for it to be behind.
      if (!doc || isDraft(tab)) continue
      const onDisk = await fileSystem().stat(tab.baseId, tab.path)
      if (!onDisk) {
        dispatch({ type: 'doc/vanished', id: tab.id })
        continue
      }
      if (onDisk.modifiedAt <= doc.version.modifiedAt) continue
      // Text that came from the note on the edge of the screen is the note's
      // to write, and that write is very likely what just changed the file.
      if (doc.dirty && !doc.remote) dispatch({ type: 'doc/conflicted', id: tab.id })
      else await reload(tab.id)
    }
  }, [reload])

  /** A name nobody is using yet in that folder. */
  const freeName = useCallback((baseId: string, parent: string, base: string): string => {
    const taken = new Set(
      (latest.current.children[entryId(baseId, parent)] ?? []).map((entry) => entry.name),
    )
    if (!taken.has(base)) return base

    const dot = base.lastIndexOf('.')
    const stem = dot <= 0 ? base : base.slice(0, dot)
    const extension = dot <= 0 ? '' : base.slice(dot)
    for (let attempt = 2; ; attempt++) {
      const candidate = stem + ' ' + attempt + extension
      if (!taken.has(candidate)) return candidate
    }
  }, [])

  const createEntry = useCallback(
    async (baseId: string, parent: string, kind: 'file' | 'folder'): Promise<Entry | null> => {
      try {
        const name = freeName(baseId, parent, kind === 'file' ? 'Sem título.md' : 'Nova pasta')
        const path = joinPath(parent, name)
        const entry =
          kind === 'file'
            ? await fileSystem().createFile(baseId, path)
            : await fileSystem().createFolder(baseId, path)
        await loadChildren(baseId, parent)
        return entry
      } catch (error) {
        report(error)
        return null
      }
    },
    [freeName, loadChildren, report],
  )

  /** Set further down, once the index can be rebuilt. See `updateLinksAfterMove`. */
  const afterMove = useRef<(baseId: string, from: string, to: string) => Promise<void>>(
    async () => {},
  )

  const renameEntry = useCallback(
    async (entry: Entry, name: string) => {
      const trimmed = name.trim()
      if (trimmed === '' || trimmed === entry.name) return
      const parent = parentPath(entry.path)
      const target = joinPath(parent, trimmed)
      try {
        await fileSystem().move(entry.baseId, entry.path, target)
        dispatch({ type: 'entry/moved', baseId: entry.baseId, from: entry.path, to: target })
        entryMoved(entry.baseId, entry.path, target)
        await loadChildren(entry.baseId, parent)
        await afterMove.current(entry.baseId, entry.path, target)
      } catch (error) {
        report(error)
      }
    },
    [loadChildren, report],
  )

  /**
   * Renames the note from its own title: a draft in memory, a file on disk.
   *
   * `stem` is the name without the extension, which the title does not let
   * anybody touch. The note does not have to be open in a tab: a file pinned
   * to the edge of the screen is renamed from the note that floats out of it.
   * Hands back what went wrong, so the title can go back to the old name and
   * say why.
   */
  const renameDocument = useCallback(
    async (tab: RenameTarget, stem: string): Promise<RenameOutcome> => {
      const id = tab.id
      const name = stem.trim()
      if (name === '') return { ok: false, message: 'O nome não pode ficar vazio.' }
      if (/[/\\:]/.test(name)) {
        return { ok: false, message: 'O nome não pode ter barra nem dois-pontos.' }
      }

      if (isDraft(tab)) {
        if (!latest.current.tabs.some((candidate) => candidate.id === id)) {
          return { ok: false, message: 'Esse rascunho não está mais aberto.' }
        }
        dispatch({ type: 'tab/renamed', id, name, named: true })
        return { ok: true, id, name }
      }

      const extension = tab.name.slice(withoutExtension(tab.name).length)
      const fileName = name + extension
      if (fileName === tab.name) return { ok: true, id, name: fileName }

      try {
        const files = fileSystem()
        if (tab.path === '') {
          if (!files.renameLoose) {
            return { ok: false, message: 'Aqui não dá para renomear um arquivo solto.' }
          }
          const target = await files.renameLoose(tab.baseId, fileName)
          dispatch({ type: 'loose/moved', from: tab.baseId, to: target })
          dispatch({
            type: 'recents/set',
            recents: rememberFile({
              baseId: target,
              path: '',
              name: fileName,
              label: target,
            }),
          })
          return {
            ok: true,
            id: entryId(target, ''),
            name: fileName,
            baseId: target,
            label: target,
          }
        }

        const parent = parentPath(tab.path)
        const target = joinPath(parent, fileName)
        // Two names that differ only in case are the same file on a Mac, and
        // renaming onto it is renaming onto itself, which is allowed.
        const clash = target.toLowerCase() !== tab.path.toLowerCase()
        if (clash && (await files.stat(tab.baseId, target))) {
          return {
            ok: false,
            message: 'Já existe um arquivo chamado ' + fileName + ' nessa pasta.',
          }
        }
        await files.move(tab.baseId, tab.path, target)
        dispatch({ type: 'entry/moved', baseId: tab.baseId, from: tab.path, to: target })
        entryMoved(tab.baseId, tab.path, target)
        void afterMove.current(tab.baseId, tab.path, target)
        await loadChildren(tab.baseId, parent)
        return { ok: true, id: entryId(tab.baseId, target), name: fileName, path: target }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
    [loadChildren],
  )

  const duplicateEntry = useCallback(
    async (entry: Entry): Promise<Entry | null> => {
      try {
        const copy = await fileSystem().duplicate(entry.baseId, entry.path)
        await loadChildren(entry.baseId, parentPath(entry.path))
        return copy
      } catch (error) {
        report(error)
        return null
      }
    },
    [loadChildren, report],
  )

  const trashEntry = useCallback(
    /** Resolves to whether the entry went to the trash. */
    async (entry: Entry): Promise<boolean> => {
      try {
        await fileSystem().trash(entry.baseId, entry.path)
        dispatch({ type: 'entry/removed', baseId: entry.baseId, path: entry.path })
        await loadChildren(entry.baseId, parentPath(entry.path))
        return true
      } catch (error) {
        report(error)
        return false
      }
    },
    [loadChildren, report],
  )

  const revealEntry = useCallback(
    async (entry: Entry) => {
      try {
        await fileSystem().reveal(entry.baseId, entry.path)
      } catch (error) {
        report(error)
      }
    },
    [report],
  )

  /**
   * Opens something from the history. The folder it lives in may not be open
   * any more, so it is reopened first. This always runs from a click, which is
   * the only moment a browser will grant a folder's permission again.
   */
  const openRecentFile = useCallback(
    async (file: RecentFile) => {
      try {
        const known = latest.current.bases.some((base) => base.id === file.baseId)
        if (!known && file.path !== '') {
          const result = await fileSystem().restoreBase(file.baseId, true)
          if (result.status !== 'ok') {
            report(new Error('A pasta desse arquivo não está mais acessível.'))
            return
          }
          dispatch({ type: 'base/added', base: result.value })
          await loadChildren(file.baseId, '')
        }
        if (!known && file.path === '') {
          const result = await fileSystem().restoreFile(file.baseId, true)
          if (result.status !== 'ok') {
            report(new Error('Esse arquivo não está mais acessível.'))
            return
          }
        }

        const id = entryId(file.baseId, file.path)
        if (restoring.current) chosen.current = id
        dispatch({
          type: 'tab/opened',
          tab: {
            id,
            baseId: file.baseId,
            path: file.path,
            name: file.name,
            preview: false,
            ...(file.label === undefined ? {} : { label: file.label }),
          },
        })
        dispatch({ type: 'recents/set', recents: rememberFile(file) })
        if (latest.current.docs[id]) return
        if (file.path !== '' && viewerOf(file.name) !== 'note') return
        const loaded = await fileSystem().read(file.baseId, file.path)
        dispatch({
          type: 'doc/loaded',
          id,
          doc: { ...loaded, dirty: false, conflict: false, gone: false },
        })
      } catch (error) {
        report(error)
      }
    },
    [loadChildren, report],
  )

  /** Closes a folder: refused while one of its tabs has unsaved changes. */
  const closeBase = useCallback(
    (baseId: string): boolean => {
      const dirty = latest.current.tabs.some(
        (tab) => tab.baseId === baseId && latest.current.docs[tab.id]?.dirty,
      )
      if (dirty) {
        report(new Error('Salve ou descarte as alterações das abas dessa pasta antes de fechá-la.'))
        return false
      }
      dispatch({ type: 'base/removed', id: baseId })
      return true
    },
    [report],
  )

  /** Resolves to the folder, already open or opened now; null when it could not be. */
  const openRecentBase = useCallback(
    async (base: RecentBase): Promise<Base | null> => {
      try {
        const open = latest.current.bases.find((one) => one.id === base.id)
        if (open) return open
        const result = await fileSystem().restoreBase(base.id, true)
        if (result.status !== 'ok') {
          report(new Error('Essa pasta não está mais acessível.'))
          return null
        }
        dispatch({ type: 'recents/set', recents: rememberBase(result.value) })
        dispatch({ type: 'base/added', base: result.value })
        await loadChildren(base.id, '')
        return result.value
      } catch (error) {
        report(error)
        return null
      }
    },
    [loadChildren, report],
  )

  /**
   * Watches every open folder, where the platform can. The desktop notices a
   * file changed by another program while the window still has focus, which is
   * the case the focus check never covered.
   */
  const watchBases = useCallback((onChange: () => void): (() => void) => {
    const stops: (() => void)[] = []
    let cancelled = false

    for (const base of latest.current.bases) {
      void fileSystem()
        .watch(base.id, onChange)
        .then((stop) => {
          if (!stop) return
          if (cancelled) stop()
          else stops.push(stop)
        })
        .catch(() => {
          // A folder that refuses to be watched is simply not watched.
        })
    }

    return () => {
      cancelled = true
      for (const stop of stops) stop()
    }
  }, [])

  const collapseAll = useCallback(() => dispatch({ type: 'folders/collapsed' }), [])

  /**
   * Reads the whole folder once, in the background, to learn what links to
   * what. Nothing on screen waits for it: the panel shows how far it got.
   */
  const indexing = useRef(new Set<string>())
  const indexBase = useCallback(async (baseId: string) => {
    if (indexing.current.has(baseId)) return
    indexing.current.add(baseId)
    dispatch({ type: 'index/progress', baseId, index: EMPTY_INDEX })
    try {
      await buildIndex(
        fileSystem(),
        baseId,
        (index) => dispatch({ type: 'index/progress', baseId, index }),
        () => false,
      )
    } finally {
      indexing.current.delete(baseId)
    }
  }, [])

  /**
   * Reads again every folder the tree has already read, and keeps what changed.
   *
   * Files created, deleted or renamed by something else (the Claude Code, the
   * file manager, the sync) used to stay out of the tree until the app was
   * opened again, because only the open tabs were checked (note #15). A folder
   * that changed also has its base indexed again, so quick open, search and
   * links see the new files too.
   */
  const refreshing = useRef(false)
  const refreshTree = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const changed = new Set<string>()
      for (const base of latest.current.bases) {
        for (const id of Object.keys(latest.current.children)) {
          const path = pathIn(id, base.id)
          if (path === null) continue
          let entries: Entry[]
          try {
            entries = await fileSystem().list(base.id, path)
          } catch {
            // A folder that went away disappears from its parent's listing.
            continue
          }
          if (sameEntries(latest.current.children[id], entries)) continue
          dispatch({ type: 'children/loaded', id, entries })
          changed.add(base.id)
        }
      }
      for (const baseId of changed) void indexBase(baseId)
    } finally {
      refreshing.current = false
    }
  }, [indexBase])

  /**
   * After a rename or a move, every note that pointed at what moved points at
   * its new place, as Obsidian does with automatic link updates on. A note
   * open with unsaved changes is left alone and named, so no edit is lost.
   */
  const updateLinksAfterMove = useCallback(
    async (baseId: string, from: string, to: string) => {
      const index = latest.current.index[baseId]
      if (!index?.done) return
      const resolve = resolverOf(index)
      const moved = new Map<string, string>()
      for (const path of index.paths) {
        if (path === from) moved.set(path, to)
        else if (path.startsWith(from + '/')) moved.set(path, to + path.slice(from.length))
      }
      if (moved.size === 0) return

      const after = index.paths.map((path) => moved.get(path) ?? path)
      const names = new Map<string, number>()
      for (const path of after) {
        const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
        names.set(name, (names.get(name) ?? 0) + 1)
      }
      const ctx = {
        moved,
        resolveBefore: (target: string, fromPath: string) => resolve.resolve(target, fromPath),
        nameIsAmbiguous: (name: string) => (names.get(name.toLowerCase()) ?? 0) > 1,
      }

      const skipped: string[] = []
      for (const file of Object.values(index.files)) {
        const touchesMoved = file.links.some((link) => moved.has(link)) || moved.has(file.path)
        if (!touchesMoved || !/\.(md|markdown)$/i.test(file.path)) continue
        const now = moved.get(file.path) ?? file.path
        const id = entryId(baseId, now)
        const doc = latest.current.docs[id]
        if (doc?.dirty) {
          skipped.push(now)
          continue
        }
        try {
          const loaded = await fileSystem().read(baseId, now)
          const text = rewriteLinks(loaded.text, file.path, now, ctx)
          if (text === null) continue
          await fileSystem().write(baseId, now, encode(text, loaded.shape))
          if (doc) await reload(id)
        } catch (error) {
          report(error)
        }
      }
      if (skipped.length) {
        report(
          new Error(
            'Links não atualizados em notas com alterações não salvas: ' + skipped.join(', '),
          ),
        )
      }
      await indexBase(baseId)
    },
    [indexBase, reload, report],
  )
  useEffect(() => {
    afterMove.current = updateLinksAfterMove
  }, [updateLinksAfterMove])

  /**
   * Moves a file or folder into another folder of the same base, by dragging in
   * the tree. Refuses to overwrite, and to put a folder inside itself. Links to
   * what moved are rewritten, as with a rename.
   */
  const moveEntry = useCallback(
    async (entry: Entry, folder: string) => {
      const from = parentPath(entry.path)
      if (folder === from) return
      if (
        entry.kind === 'directory' &&
        (folder === entry.path || folder.startsWith(entry.path + '/'))
      ) {
        report(new Error('Uma pasta não pode ir para dentro dela mesma.'))
        return
      }
      const target = joinPath(folder, entry.name)
      try {
        if (await fileSystem().stat(entry.baseId, target)) {
          report(new Error(`Já existe ${entry.name} em ${folder || 'a raiz'}.`))
          return
        }
        await fileSystem().move(entry.baseId, entry.path, target)
        dispatch({ type: 'entry/moved', baseId: entry.baseId, from: entry.path, to: target })
        entryMoved(entry.baseId, entry.path, target)
        await loadChildren(entry.baseId, from)
        await loadChildren(entry.baseId, folder)
        await updateLinksAfterMove(entry.baseId, entry.path, target)
      } catch (error) {
        report(error)
      }
    },
    [loadChildren, report, updateLinksAfterMove],
  )

  const forgetRecents = useCallback(
    () => dispatch({ type: 'recents/set', recents: clearRecents() }),
    [],
  )

  const forgetRecentFile = useCallback(
    (baseId: string, path: string) =>
      dispatch({ type: 'recents/set', recents: forgetFile(baseId, path) }),
    [],
  )

  const forgetRecentBase = useCallback(
    (id: string) => dispatch({ type: 'recents/set', recents: forgetBase(id) }),
    [],
  )

  const expandFolder = useCallback(
    async (baseId: string, path: string) => {
      dispatch({ type: 'folder/expanded', id: entryId(baseId, path) })
      await loadChildren(baseId, path)
    },
    [loadChildren],
  )

  /** Opens every folder on the way to a path, so the row can be seen. */
  const revealPath = useCallback(
    async (baseId: string, path: string) => {
      const segments = path.split('/').slice(0, -1)
      let walked = ''
      for (const segment of segments) {
        walked = joinPath(walked, segment)
        await expandFolder(baseId, walked)
      }
    },
    [expandFolder],
  )

  /**
   * Reopens what was open last time. `interactive` may only be true when this
   * runs inside a click: that is the one moment a browser lets us ask for a
   * folder's permission back.
   */
  const restoreSession = useCallback(
    async (session: Session, interactive: boolean) => {
      restoring.current = true
      const pending: string[] = []
      const available = new Set<string>()

      for (const baseId of session.bases) {
        const result = await fileSystem().restoreBase(baseId, interactive)
        if (result.status === 'needs-permission') pending.push(baseId)
        if (result.status !== 'ok') continue
        available.add(baseId)
        dispatch({ type: 'base/added', base: result.value })
        await loadChildren(baseId, '')
      }

      for (const baseId of session.files) {
        const result = await fileSystem().restoreFile(baseId, interactive)
        if (result.status === 'needs-permission') pending.push(baseId)
        if (result.status === 'ok') available.add(baseId)
      }

      for (const id of byDepth(session.expanded)) {
        const baseId = [...available].find((base) => pathIn(id, base) !== null)
        if (baseId === undefined) continue
        const path = pathIn(id, baseId)!
        dispatch({ type: 'folder/expanded', id })
        await loadChildren(baseId, path)
      }

      const restoredIds: string[] = []
      for (const tab of session.tabs) {
        if (!available.has(tab.baseId)) continue
        try {
          // A viewer tab has no document: it only has to still exist.
          if (tab.path !== '' && viewerOf(tab.name) !== 'note') {
            if (!(await fileSystem().stat(tab.baseId, tab.path))) continue
            restoredIds.push(tab.id)
            dispatch({ type: 'tab/opened', tab: toTab(tab) })
            continue
          }
          const loaded = await fileSystem().read(tab.baseId, tab.path)
          restoredIds.push(tab.id)
          dispatch({ type: 'tab/opened', tab: toTab(tab) })
          dispatch({
            type: 'doc/loaded',
            id: tab.id,
            doc: { ...loaded, dirty: false, conflict: false, gone: false },
          })
        } catch {
          // A file that moved or was deleted simply does not come back.
        }
      }

      const chose = chosen.current
      const asked = chose && latest.current.tabs.some((tab) => tab.id === chose) ? chose : null
      if (asked) {
        dispatch({ type: 'tab/activated', id: asked })
      } else if (
        session.activeId &&
        (latest.current.docs[session.activeId] ||
          latest.current.tabs.some((tab) => tab.id === session.activeId)) &&
        restoreMayChooseActive(latest.current.activeId, restoredIds)
      ) {
        dispatch({ type: 'tab/activated', id: session.activeId })
      }
      chosen.current = null
      restoring.current = false

      dispatch({ type: 'session/restored', pending, asked })
    },
    [loadChildren],
  )

  // Kept up to date rather than reordered, because moving either function
  // would drag half the file with it.
  useEffect(() => {
    openRecent.current = openRecentFile
  }, [openRecentFile])

  const actions = useMemo(
    () => ({
      openBase,
      openLooseFile,
      openRecentFile,
      openRecentBase,
      closeBase,
      newNote,
      forgetRecents,
      forgetRecentFile,
      forgetRecentBase,
      restoreSession,
      refreshTree,
      createEntry,
      renameEntry,
      moveEntry,
      renameDocument,
      duplicateEntry,
      trashEntry,
      revealEntry,
      collapseAll,
      indexBase,
      expandFolder,
      revealPath,
      toggleFolder,
      openFile,
      save,
      reload,
      checkExternalChanges,
      watchBases,
      pinTab: (id: string) => dispatch({ type: 'tab/pinned', id }),
      renameTab: (id: string, name: string) => dispatch({ type: 'tab/renamed', id, name }),
      /** Text typed into the same note in another window. */
      sync: (id: string, text: string) => dispatch({ type: 'doc/synced', id, text }),
      savedElsewhere: (id: string, text: string, version: FileVersion) =>
        dispatch({ type: 'doc/saved-elsewhere', id, text, version }),
      closeTab: (id: string) => dispatch({ type: 'tab/closed', id }),
      activateTab: (id: string | null) => dispatch({ type: 'tab/activated', id }),
      edit: (id: string, text: string) => dispatch({ type: 'doc/edited', id, text }),
      setFilter: (value: string) => dispatch({ type: 'filter/set', value }),
      dismissError: () => dispatch({ type: 'error/set', message: null }),
    }),
    [
      checkExternalChanges,
      collapseAll,
      createEntry,
      newNote,
      forgetRecents,
      forgetRecentFile,
      forgetRecentBase,
      indexBase,
      expandFolder,
      revealPath,
      duplicateEntry,
      renameDocument,
      renameEntry,
      moveEntry,
      revealEntry,
      trashEntry,
      watchBases,
      openBase,
      openFile,
      openLooseFile,
      openRecentBase,
      closeBase,
      openRecentFile,
      refreshTree,
      reload,
      restoreSession,
      save,
      toggleFolder,
    ],
  )

  return { state, actions }
}

/**
 * Whether a folder read again shows the same entries, so an unchanged tree is
 * not rendered again on every check.
 */
export function sameEntries(
  before: readonly Entry[] | undefined,
  after: readonly Entry[],
): boolean {
  if (!before || before.length !== after.length) return false
  return before.every((entry, i) => entry.id === after[i]!.id && entry.kind === after[i]!.kind)
}

/**
 * The path of an entry id `<baseId>:<path>`, when it belongs to `baseId`; null when
 * it does not.
 *
 * Asked against a known base rather than cut at a colon: on Windows the base itself
 * is `C:\…`, and cutting at the first colon split it at the drive letter. Every
 * id then looked like it belonged to a base called `C`, and a rename on Windows
 * left the active tab and the loaded text behind under the old name (note #8).
 */
export function pathIn(id: string, baseId: string): string | null {
  return id.startsWith(baseId + ':') ? id.slice(baseId.length + 1) : null
}

function toTab(tab: SessionTab): Tab {
  return {
    id: tab.id,
    baseId: tab.baseId,
    path: tab.path,
    name: tab.name,
    preview: tab.preview,
    ...(tab.label === undefined ? {} : { label: tab.label }),
  }
}

function remapId(
  id: string,
  baseId: string,
  under: (path: string) => boolean,
  moved: (path: string) => string,
): string {
  const path = pathIn(id, baseId)
  return path !== null && under(path) ? entryId(baseId, moved(path)) : id
}

/** How a tab is shown: the editor for notes, drafts and loose files, a viewer for the rest. */
export function tabViewer(tab: Tab): Viewer {
  if (tab.path === '' || isDraft(tab)) return 'note'
  return viewerOf(tab.name) ?? 'note'
}

export function isPlainTextTab(tab: Tab): boolean {
  return isPlainText(tab.name)
}
