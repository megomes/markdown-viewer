/**
 * The quick switcher: type part of a name or an alias, Enter opens it. The same
 * idea as Obsidian's `Ctrl+O` and VS Code's `Ctrl+P`.
 *
 * The same box picks a destination for the tree's menu: a folder for "Mover
 * para…", a note for "Mesclar com…".
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import { switcher } from '@markdown-viewer/core/search'

interface Props {
  indexes: Record<string, BaseIndex>
  onOpen: (baseId: string, path: string) => void
  onClose: () => void
  /** What is listed: anything to open (the default), folders, or notes. */
  mode?: 'open' | 'folder' | 'note'
  /** Left out of the list: the note being merged, the folder it is already in. */
  exclude?: string
  placeholder?: string
}

const ROOT_LABEL = 'Raiz do vault'

/** Every folder that holds something, the root included. */
function foldersOf(index: BaseIndex): string[] {
  const folders = new Set<string>([''])
  for (const path of index.paths) {
    let at = path.lastIndexOf('/')
    while (at > 0) {
      const folder = path.slice(0, at)
      if (folders.has(folder)) break
      folders.add(folder)
      at = folder.lastIndexOf('/')
    }
  }
  return [...folders].filter((folder) => !folder.split('/').some((part) => part.startsWith('.')))
}

export function QuickOpen({
  indexes,
  onOpen,
  onClose,
  mode = 'open',
  exclude,
  placeholder,
}: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  const items = useMemo(() => {
    const out: { baseId: string; path: string; label: string; alias: boolean }[] = []
    for (const [baseId, index] of Object.entries(indexes)) {
      if (mode === 'folder') {
        const folders = foldersOf(index).filter((folder) => folder !== exclude)
        if (exclude !== '' && (!query || ROOT_LABEL.toLowerCase().includes(query.toLowerCase())))
          out.push({ baseId, path: '', label: ROOT_LABEL, alias: false })
        const named = folders.filter(Boolean).map((path) => ({ path, aliases: [] }))
        for (const item of switcher(query, named, 50)) out.push({ baseId, ...item })
        continue
      }
      const files = Object.values(index.files)
        .filter((file) => file.path !== exclude)
        .map((file) => ({ path: file.path, aliases: file.aliases }))
      // Files that are not notes are found by name too: PDFs, pages, images.
      if (mode === 'open') {
        for (const path of index.paths) {
          if (!/\.(md|markdown|txt)$/i.test(path)) files.push({ path, aliases: [] })
        }
      } else {
        for (let i = files.length - 1; i >= 0; i--) {
          if (!/\.(md|markdown)$/i.test(files[i]!.path)) files.splice(i, 1)
        }
      }
      for (const item of switcher(query, files, 50)) out.push({ baseId, ...item })
    }
    return out.slice(0, 50)
  }, [indexes, query, mode, exclude])

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const pick = (index: number) => {
    const item = items[index]
    if (!item) return
    onOpen(item.baseId, item.path)
    onClose()
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label={placeholder ?? 'Abrir rápido'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder={placeholder ?? 'Nome ou apelido da nota…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((i) => Math.min(i + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(selected)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <ul className="palette-list" ref={list}>
          {items.map((item, i) => (
            <li
              key={item.baseId + item.path + item.label}
              className={'palette-item' + (i === selected ? ' is-selected' : '')}
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
            >
              <span className="palette-label">
                {item.alias && <span className="palette-alias">apelido</span>}
                {item.label}
              </span>
              <span className="palette-path">{item.path}</span>
            </li>
          ))}
          {items.length === 0 && <li className="palette-empty">Nada com esse nome.</li>}
        </ul>
      </div>
    </div>
  )
}
