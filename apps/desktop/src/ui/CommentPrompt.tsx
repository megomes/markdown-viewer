/** Asks for the request that goes with a selected passage of a note. */

import { useState } from 'react'
import { onApple } from './shortcuts'

interface Props {
  selected: string
  onSave: (comment: string) => void
  onClose: () => void
}

export function CommentPrompt({ selected, onSave, onClose }: Props) {
  const [comment, setComment] = useState('')
  const save = () => {
    if (comment.trim()) onSave(comment.trim())
  }
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="comment-prompt"
        role="dialog"
        aria-label="Comentar trecho"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="comment-quote">
          “{selected.length > 220 ? selected.slice(0, 217) + '…' : selected}”
        </p>
        <textarea
          autoFocus
          rows={4}
          placeholder="O que deve mudar aqui? O Claude lê pelo MCP ou pelo Copiar pedidos."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <div className="comment-actions">
          <span>{onApple() ? '⌘↵' : 'Ctrl+↵'} para guardar</span>
          <button type="button" className="sync-primary" disabled={!comment.trim()} onClick={save}>
            Comentar
          </button>
        </div>
      </div>
    </div>
  )
}
