/**
 * An Obsidian Base, read-only: its views as tabs, each a table or cards, grouped
 * and sorted as the `.base` file says. A row opens its note.
 *
 * Knows nothing of where the files come from, so the phone draws the same page
 * (apps/mobile/src/dom/BaseScreen.tsx) and the desktop wraps it in BaseViewer.
 */

import { useEffect, useMemo, useState } from 'react'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import { parseBase, runView, showValue, type BaseFile } from '@markdown-viewer/core/bases'

/** The notes of an index, as a Base reads them. */
export function baseFiles(index: BaseIndex | undefined): BaseFile[] {
  return Object.values(index?.files ?? {})
    .filter((file) => /\.(md|markdown)$/i.test(file.path))
    .map((file) => ({
      path: file.path,
      tags: file.tags,
      links: file.links,
      embeds: file.embeds,
      properties: file.properties,
    }))
}

/** An image's address, and how to let it go when it is no longer shown. */
export type ImageUrl = (path: string) => Promise<{ url: string; revoke?: () => void }>

function Cell({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return <span className="base-check">{value ? '☑' : '☐'}</span>
  return <>{showValue(value)}</>
}

function Cover({ path, imageUrl }: { path: string; imageUrl: ImageUrl }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoke: (() => void) | undefined
    let cancelled = false
    void imageUrl(path)
      .then((file) => {
        revoke = file.revoke
        if (cancelled) file.revoke?.()
        else setUrl(file.url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      revoke?.()
    }
  }, [path, imageUrl])
  return url ? (
    <img className="base-cover" src={url} alt="" loading="lazy" />
  ) : (
    <div className="base-cover" />
  )
}

export function BaseView({
  name,
  text,
  files,
  ready,
  imageUrl,
  open,
}: {
  name: string
  /** The `.base` file, or null while it is read. */
  text: string | null
  files: BaseFile[]
  /** Whether the index has read the whole vault. */
  ready: boolean
  imageUrl: ImageUrl
  open: (notePath: string) => void
}) {
  const [viewIndex, setViewIndex] = useState(0)
  const config = useMemo(() => (text === null ? null : parseBase(text)), [text])
  const result = useMemo(
    () => (config ? runView(config, viewIndex, files) : null),
    [config, viewIndex, files],
  )

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="viewer-name">{name}</span>
        {config && (
          <div className="viewer-seg" role="tablist" aria-label="Visões">
            {config.views.map((view, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={i === viewIndex}
                onClick={() => setViewIndex(i)}
              >
                {view.name}
              </button>
            ))}
          </div>
        )}
        {result && <span className="viewer-note">{result.total} itens</span>}
      </div>
      <div className="base-body">
        {!ready && <p className="viewer-status">Lendo o vault…</p>}
        {result?.errors.map((error) => (
          <p key={error} className="viewer-status is-error">
            {error}
          </p>
        ))}
        {result?.groups.map((group, g) => (
          <section key={g} className="base-group">
            {result.view.groupBy && (
              <h3 className="base-group-title">
                {showValue(group.key) || 'Sem valor'} <span>{group.rows.length}</span>
              </h3>
            )}
            {result.view.type === 'cards' ? (
              <div className="base-cards">
                {group.rows.map((row) => (
                  <button
                    key={row.path}
                    type="button"
                    className="base-card"
                    onClick={() => open(row.path)}
                  >
                    {row.image ? (
                      <Cover path={row.image} imageUrl={imageUrl} />
                    ) : (
                      <div className="base-cover" />
                    )}
                    <span className="base-card-title">
                      <Cell value={row.values[result.columns[0]!.key]} />
                    </span>
                    {result.columns.slice(1).map((column) => (
                      <span key={column.key} className="base-card-field">
                        <span>{column.label}</span>
                        <Cell value={row.values[column.key]} />
                      </span>
                    ))}
                  </button>
                ))}
              </div>
            ) : (
              <table className="base-table">
                <thead>
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.path} onClick={() => open(row.path)}>
                      {result.columns.map((column) => (
                        <td key={column.key}>
                          <Cell value={row.values[column.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
