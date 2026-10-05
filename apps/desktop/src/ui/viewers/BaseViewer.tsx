/**
 * An Obsidian Base, read-only: its views as tabs, each a table or cards, grouped
 * and sorted as the `.base` file says. A row opens its note.
 */

import { useEffect, useMemo, useState } from 'react'
import type { BaseIndex } from '@markdown-viewer/core/base-index'
import {
  parseBase,
  runView,
  showValue,
  type BaseConfig,
  type BaseFile,
} from '@markdown-viewer/core/bases'
import { fileSystem } from '~/platform'
import { fileUrl } from '~/platform/assets'
import { openTarget } from '~/editor/links'

interface Props {
  baseId: string
  path: string
  name: string
  index: BaseIndex | undefined
  report: (message: string) => void
}

function Cell({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return <span className="base-check">{value ? '☑' : '☐'}</span>
  return <>{showValue(value)}</>
}

function Cover({ baseId, path }: { baseId: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoke: (() => void) | undefined
    let cancelled = false
    void fileUrl(baseId, path).then((file) => {
      revoke = file.revoke
      if (cancelled) file.revoke?.()
      else setUrl(file.url)
    })
    return () => {
      cancelled = true
      revoke?.()
    }
  }, [baseId, path])
  return url ? (
    <img className="base-cover" src={url} alt="" loading="lazy" />
  ) : (
    <div className="base-cover" />
  )
}

export function BaseViewer({ baseId, path, name, index, report }: Props) {
  const [config, setConfig] = useState<BaseConfig | null>(null)
  const [viewIndex, setViewIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fileSystem()
      .read(baseId, path)
      .then(({ text }) => {
        if (!cancelled) setConfig(parseBase(text))
      })
      .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [baseId, path, report])

  const files: BaseFile[] = useMemo(
    () =>
      Object.values(index?.files ?? {})
        .filter((file) => /\.(md|markdown)$/i.test(file.path))
        .map((file) => ({
          path: file.path,
          tags: file.tags,
          links: file.links,
          embeds: file.embeds,
          properties: file.properties,
        })),
    [index],
  )

  const result = useMemo(
    () => (config ? runView(config, viewIndex, files) : null),
    [config, viewIndex, files],
  )

  const open = (notePath: string) => openTarget({ baseId, path: notePath, subpath: null })

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
        {!index?.done && <p className="viewer-status">Lendo o vault…</p>}
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
                      <Cover baseId={baseId} path={row.image} />
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
