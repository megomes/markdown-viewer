/**
 * Search across every note of the open folders, with the small query language of
 * `@markdown-viewer/core/search`: words, "frases", #tag, path:pasta, -excluir.
 * Below the box, the tags of the vault, most used first, one click to filter.
 */

import { useEffect, useMemo, useState } from 'react'
import { tagCounts, type BaseIndex } from '@markdown-viewer/core/base-index'
import { search, type SearchResult } from '@markdown-viewer/core/search'
import { searchDocs } from '~/app/vault-text'

interface Props {
  indexes: Record<string, BaseIndex>
  initialQuery?: string
  onOpen: (baseId: string, path: string, line: number | null) => void
  onClose: () => void
}

interface Found extends SearchResult {
  baseId: string
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = []
  let at = 0
  ranges.forEach(([from, to], i) => {
    if (from < at) return
    parts.push(text.slice(at, from), <mark key={i}>{text.slice(from, to)}</mark>)
    at = to
  })
  parts.push(text.slice(at))
  return <>{parts}</>
}

export function SearchPanel({ indexes, initialQuery = '', onOpen, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery)
  // Results remember the query they answer, so a stale list is never shown as current.
  const [answered, setAnswered] = useState<{ query: string; items: Found[] } | null>(null)
  const trimmed = query.trim()
  const results = trimmed ? (answered?.items ?? []) : null
  const busy = trimmed !== '' && answered?.query !== trimmed

  const tags = useMemo(() => {
    const merged = new Map<string, number>()
    for (const index of Object.values(indexes)) {
      for (const [tag, count] of tagCounts(index)) merged.set(tag, (merged.get(tag) ?? 0) + count)
    }
    return [...merged].sort((a, b) => b[1] - a[1]).slice(0, 40)
  }, [indexes])

  useEffect(() => {
    if (!trimmed) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const found: Found[] = []
      for (const [baseId, index] of Object.entries(indexes)) {
        const docs = await searchDocs(index)
        for (const result of search(trimmed, docs)) found.push({ ...result, baseId })
      }
      if (cancelled) return
      setAnswered({ query: trimmed, items: found.sort((a, b) => b.score - a.score).slice(0, 200) })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, indexes])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="search-layer">
      <div className="search-page">
        <div className="search-head">
          <input
            className="search-box"
            autoFocus
            placeholder='Buscar no vault: palavras, "frase", #tag, path:pasta, -excluir'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            ×
          </button>
        </div>

        {results === null ? (
          <div className="search-tags">
            <p className="info-title">Tags</p>
            <div className="search-tag-list">
              {tags.map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  className="search-tag"
                  onClick={() => setQuery('#' + tag)}
                >
                  #{tag} <span>{count}</span>
                </button>
              ))}
              {tags.length === 0 && <p className="search-empty">Nenhuma tag ainda.</p>}
            </div>
          </div>
        ) : (
          <div className="search-results">
            <p className="search-count">
              {busy
                ? 'Buscando…'
                : `${results.length} ${results.length === 1 ? 'arquivo' : 'arquivos'}`}
            </p>
            {results.map((result) => (
              <div key={result.baseId + result.path} className="search-result">
                <button
                  type="button"
                  className="search-file"
                  onClick={() => onOpen(result.baseId, result.path, null)}
                >
                  <span className="search-title">{result.title}</span>
                  <span className="search-path">{result.path}</span>
                </button>
                {result.matches.map((match) => (
                  <button
                    key={match.line}
                    type="button"
                    className="search-line"
                    onClick={() => onOpen(result.baseId, result.path, match.line)}
                  >
                    <span className="search-line-number">{match.line + 1}</span>
                    <Highlighted text={match.preview} ranges={match.ranges} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
