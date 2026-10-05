import { memo, useEffect, useRef } from 'react'
import { isPlainText, isTextFile, viewerOf, type Entry } from '@markdown-viewer/core/fs'
import { ChevronIcon, FileIcon, FolderIcon, MarkdownIcon } from './icons'
import { NamedIcon } from './NamedIcon'

/**
 * The tree takes the slices of state it actually reads instead of the whole
 * workspace. Editing a document changes the workspace object on every
 * keystroke, and a tree that depended on it would render the whole vault again
 * each time a key is pressed.
 */
export interface TreeData {
  children: Record<string, Entry[]>
  expanded: Record<string, boolean>
  activeId: string | null
  filter: string
  /** Entry id to an Iconize icon name, for folders that have one. */
  icons?: Record<string, string>
}

export interface TreeHandlers {
  onToggleFolder: (entry: Entry) => void
  onOpenFile: (entry: Entry, preview: boolean) => void
  onContextMenu: (entry: Entry, x: number, y: number) => void
  onStartRename: (entry: Entry) => void
  onRename: (entry: Entry, name: string) => void
  onCancelRename: () => void
  onTrash: (entry: Entry) => void
  /** Moves an entry into a folder of the same base ('' is the root). */
  onMove: (entry: Entry, folder: string) => void
}

/**
 * What is being dragged, kept here and not in the drag data: the data is only
 * readable on drop, and the rows need to know during the drag whether they can
 * take it.
 */
let dragged: Entry | null = null

export function draggedEntry(): Entry | null {
  return dragged
}

/** Whether `entry` may be dropped into `folder` of `baseId`. */
export function canDrop(entry: Entry | null, baseId: string, folder: string): entry is Entry {
  if (!entry || entry.baseId !== baseId) return false
  const from = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
  if (folder === from) return false
  return !(
    entry.kind === 'directory' &&
    (folder === entry.path || folder.startsWith(entry.path + '/'))
  )
}

interface Props extends TreeHandlers {
  data: TreeData
  /** Entry id of the folder whose children we are drawing. */
  parentId: string
  depth: number
  showAllFiles: boolean
  /** Entry id of the row that is currently being renamed, if any. */
  renamingId: string | null
}

/** True when the entry itself matches, or any loaded descendant does. */
function matchesFilter(data: TreeData, entry: Entry, filter: string): boolean {
  if (entry.name.toLowerCase().includes(filter)) return true
  if (entry.kind === 'file') return false
  return (data.children[entry.id] ?? []).some((child) => matchesFilter(data, child, filter))
}

/** Folder, Markdown file, plain text and everything else each get their own mark. */
function EntryIcon({ entry, icon }: { entry: Entry; icon?: string | undefined }) {
  if (icon) return <NamedIcon name={icon} className="tree-icon is-named" />
  if (entry.kind === 'directory') return <FolderIcon size={15} className="tree-icon is-folder" />
  if (isPlainText(entry.name)) return <FileIcon size={15} className="tree-icon is-text" />
  if (isTextFile(entry.name)) return <MarkdownIcon size={15} className="tree-icon is-markdown" />
  return <FileIcon size={15} className="tree-icon is-other" />
}

export const FileTree = memo(function FileTree({
  data,
  parentId,
  depth,
  showAllFiles,
  renamingId,
  ...on
}: Props) {
  const filter = data.filter.trim().toLowerCase()
  const entries = (data.children[parentId] ?? []).filter((entry) => {
    // Notes and everything the app can show; the rest only when asked for.
    if (entry.kind === 'file' && !showAllFiles && !viewerOf(entry.name)) return false
    return filter === '' || matchesFilter(data, entry, filter)
  })

  return (
    <ul className={'tree' + (depth > 0 ? ' is-nested' : '')} role="group">
      {entries.map((entry) => {
        const open = data.expanded[entry.id] === true
        const readable = entry.kind === 'directory' || viewerOf(entry.name) !== null
        // A file row takes a drop into its own folder; a folder row, into itself.
        const dropFolder =
          entry.kind === 'directory'
            ? entry.path
            : entry.path.includes('/')
              ? entry.path.slice(0, entry.path.lastIndexOf('/'))
              : ''
        const openEntry = (preview: boolean) => {
          if (entry.kind === 'directory') on.onToggleFolder(entry)
          else if (readable) on.onOpenFile(entry, preview)
        }

        return (
          <li key={entry.id}>
            {renamingId === entry.id ? (
              <RenameRow entry={entry} onRename={on.onRename} onCancel={on.onCancelRename} />
            ) : (
              <button
                type="button"
                className={
                  'tree-row' +
                  (data.activeId === entry.id ? ' is-active' : '') +
                  (readable ? '' : ' is-muted')
                }
                role="treeitem"
                aria-expanded={entry.kind === 'directory' ? open : undefined}
                title={entry.name}
                draggable
                onDragStart={(event) => {
                  dragged = entry
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', entry.path)
                }}
                onDragEnd={() => {
                  dragged = null
                  for (const el of document.querySelectorAll('.is-drop-target'))
                    el.classList.remove('is-drop-target')
                }}
                onDragOver={(event) => {
                  if (!canDrop(dragged, entry.baseId, dropFolder)) return
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'move'
                  const row = event.currentTarget
                  if (!row.classList.contains('is-drop-target')) {
                    for (const el of document.querySelectorAll('.is-drop-target'))
                      el.classList.remove('is-drop-target')
                    row.classList.add('is-drop-target')
                    // Holding over a closed folder opens it, to drop deeper.
                    if (entry.kind === 'directory' && !open) {
                      window.setTimeout(() => {
                        if (row.classList.contains('is-drop-target') && dragged)
                          on.onToggleFolder(entry)
                      }, 700)
                    }
                  }
                }}
                onDragLeave={(event) => event.currentTarget.classList.remove('is-drop-target')}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.classList.remove('is-drop-target')
                  const moving = dragged
                  dragged = null
                  if (canDrop(moving, entry.baseId, dropFolder)) on.onMove(moving, dropFolder)
                }}
                onClick={() => openEntry(true)}
                onDoubleClick={() => entry.kind === 'file' && openEntry(false)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  on.onContextMenu(entry, event.clientX, event.clientY)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'F2') {
                    event.preventDefault()
                    on.onStartRename(entry)
                  }
                  // The system trash makes this recoverable, but it still asks
                  // for the modifier so a stray Backspace cannot do it.
                  if ((event.key === 'Backspace' || event.key === 'Delete') && event.metaKey) {
                    event.preventDefault()
                    on.onTrash(entry)
                  }
                }}
              >
                <ChevronIcon
                  size={12}
                  className={
                    'tree-twisty' +
                    (entry.kind === 'directory' ? (open ? ' is-open' : '') : ' is-leaf')
                  }
                />
                <EntryIcon entry={entry} icon={data.icons?.[entry.id]} />
                <span className="tree-name">{entry.name}</span>
              </button>
            )}
            {entry.kind === 'directory' && open && (
              <FileTree
                data={data}
                parentId={entry.id}
                depth={depth + 1}
                showAllFiles={showAllFiles}
                renamingId={renamingId}
                {...on}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
})

interface RenameProps {
  entry: Entry
  onRename: (entry: Entry, name: string) => void
  onCancel: () => void
}

function RenameRow({ entry, onRename, onCancel }: RenameProps) {
  const input = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    const field = input.current
    if (!field) return
    field.focus()
    // Select the name without the extension, which is the part being changed.
    const dot = entry.name.lastIndexOf('.')
    field.setSelectionRange(0, dot > 0 ? dot : entry.name.length)
  }, [entry.name])

  const settle = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    if (commit && input.current) onRename(entry, input.current.value)
    else onCancel()
  }

  return (
    <div className="tree-row is-renaming">
      <span className="tree-twisty is-leaf" />
      <EntryIcon entry={entry} />
      <input
        ref={input}
        className="tree-rename"
        defaultValue={entry.name}
        aria-label={'Renomear ' + entry.name}
        onKeyDown={(event) => {
          if (event.key === 'Enter') settle(true)
          if (event.key === 'Escape') settle(false)
        }}
        onBlur={() => settle(true)}
      />
    </div>
  )
}
