/**
 * The quick switcher: type part of a name or an alias, Enter opens it. The same
 * idea as Obsidian's `Ctrl+O` and VS Code's `Ctrl+P`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import { switcher } from '@markdown-viewer/core/search'

interface Props {
  indexes: Record<string, BaseIndex>
  onOpen: (baseId: string, path: string) => void
  onClose: () => void
}

export function QuickOpen({ indexes, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  const items = useMemo(() => {
    const out: { baseId: string; path: string; label: string; alias: boolean }[] = []
    for (const [baseId, index] of Object.entries(indexes)) {
      const files = Object.values(index.files).map((file) => ({
        path: file.path,
        aliases: file.aliases,
      }))
      // Files that are not notes are found by name too: PDFs, pages, images.
      for (const path of index.paths) {
        if (!/\.(md|markdown|txt)$/i.test(path)) files.push({ path, aliases: [] })
      }
      for (const item of switcher(query, files, 50)) out.push({ baseId, ...item })
    }
    return out.slice(0, 50)
  }, [indexes, query])

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
        aria-label="Abrir rápido"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder="Nome ou apelido da nota…"
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
