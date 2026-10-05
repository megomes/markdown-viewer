/**
 * The review comments on the open note, in the side panel: what was asked, what
 * Claude answered, a click to find the passage, and the export for Claude.
 */

import { useEffect, useState } from 'react'
import { buildReviewExport, pendingItems, type ReviewState } from '@markdown-viewer/core/review'
import { fileSystem } from '~/platform'
import { onNoteComments, readNoteComments, removeNoteComment } from '~/app/note-comments'

interface Props {
  baseId: string
  path: string
  name: string
  onFind: (text: string) => void
}

export function NoteComments({ baseId, path, name, onFind }: Props) {
  const [review, setReview] = useState<ReviewState | null>(null)
  const [nonce, setNonce] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => onNoteComments(() => setNonce((n) => n + 1)), [])
  useEffect(() => {
    let cancelled = false
    void readNoteComments(baseId, path).then((value) => {
      if (!cancelled) setReview(value)
    })
    return () => {
      cancelled = true
    }
  }, [baseId, path, nonce])

  const items = review?.items.filter((item) => item.comment.trim()) ?? []
  const pending = pendingItems(review)

  return (
    <div className="note-comments">
      <p className="info-title">
        Comentários ({items.length})
        {pending.length > 0 && (
          <button
            type="button"
            className="note-comments-copy"
            onClick={() => {
              const text = buildReviewExport([
                {
                  filePath: fileSystem().absolutePath(baseId, path) ?? path,
                  title: name,
                  items: pending,
                },
              ])
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? 'copiado' : 'copiar pedidos'}
          </button>
        )}
      </p>
      {items.length === 0 && (
        <p className="info-empty">Selecione um trecho e use Ctrl/⌘+Shift+M para comentar.</p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.claude ? 'is-' + item.claude.status : 'is-open'}>
            <button
              type="button"
              className="note-comment-anchor"
              onClick={() => onFind(item.anchor)}
            >
              {item.n}. “{item.anchor}”
            </button>
            <p>{item.comment}</p>
            {item.claude && (
              <p className="note-comment-claude">
                Claude: {item.claude.status === 'applied' ? 'aplicado' : 'não aplicado'}
                {item.claude.note ? `. ${item.claude.note}` : ''}
              </p>
            )}
            <button
              type="button"
              className="note-comment-remove"
              onClick={() => void removeNoteComment(baseId, path, item.id)}
            >
              tirar
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
