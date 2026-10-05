/**
 * Feedback do app: comentários sobre o app, numerados, que o Claude trabalha e
 * resolve registrando exatamente o que fez.
 *
 * Port da página Notes do DailyFlow (`web/src/app/(app)/notes/page.tsx`, commit
 * 3fd41c3), mantida igual de propósito: mesma estrutura, estados, regras, atalhos e
 * textos (traduzidos). O que mudou é só o ambiente, como manda a seção 6.9 de
 * docs/spec.md: a API é um Worker da Cloudflare com código de acesso, a tela abre
 * por cima do editor sem perder o lugar, e não há analytics de produto.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  GitCommitHorizontal,
  MessageSquareWarning,
  MonitorSmartphone,
  Pencil,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react'
import {
  collectContext,
  deviceId,
  summarizeContext,
  type ClientContext,
} from '~/app/client-context'
import { isDesktop } from '~/platform'
import { onApple } from './shortcuts'
import './feedback.css'

type Kind = 'bug' | 'idea' | 'ux' | 'question'
type Status = 'open' | 'discussing' | 'in_progress' | 'done' | 'ignored' | 'archived'
type Filter = 'all' | 'open' | 'in_progress' | 'done' | 'ignored'

interface LogEntry {
  ts: string
  actor: 'user' | 'claude'
  action: string
  message: string | null
  detail: Record<string, unknown>
}
interface Resolution {
  summary?: string
  done?: string[]
  ignored?: string[]
  decisions?: string[]
  follow_ups?: string[]
  commits?: string[]
  deployed?: string
}
interface Note {
  id: number
  body: string
  kind: Kind
  status: Status
  stage: string | null
  appVersion: string | null
  screen: string | null
  resolution: Resolution
  context: Partial<ClientContext> & { server?: Record<string, unknown> }
  createdAt: string
  updatedAt: string
  log: LogEntry[]
}
interface Pending {
  clientId: string
  body: string
  kind: Kind
  screen: string
  createdAt: string
  context: ClientContext
}

const m = {
  title: 'Feedback',
  subtitle:
    'Comentários sobre o app. Cada um ganha um número; o Claude trabalha neles e registra exatamente o que foi feito.',
  placeholder: 'O que deveria mudar, o que incomodou, o que está faltando…',
  add: 'Adicionar',
  kinds: { bug: 'Bug', idea: 'Ideia', ux: 'UX', question: 'Pergunta' } as Record<Kind, string>,
  status: {
    open: 'Aberta',
    discussing: 'Em discussão',
    in_progress: 'Em andamento',
    done: 'Feita',
    ignored: 'Ignorada',
    archived: 'Confirmada',
  } as Record<Status, string>,
  verify: 'Testou?',
  works: 'Funciona',
  notYet: 'Ainda não',
  worksHint: 'Confirma e arquiva a nota',
  notYetHint: 'Reabre a nota com o seu comentário',
  rejectPlaceholder: 'O que ainda está errado ou faltando?',
  rejectSend: 'Reabrir com comentário',
  archived: (n: number) => `Arquivadas · ${n}`,
  backToActive: 'Voltar para as ativas',
  archivedTitle: 'Confirmadas e arquivadas',
  feedback: 'Seu retorno',
  filters: {
    all: 'Todas',
    open: 'Abertas',
    in_progress: 'Em andamento',
    done: 'Feitas',
    ignored: 'Ignoradas',
  } as Record<Filter, string>,
  edit: 'Editar',
  save: 'Salvar',
  cancel: 'Cancelar',
  delete: 'Excluir',
  confirmDelete: 'Confirmar exclusão',
  pending: 'Aguardando conexão',
  offline: 'Offline: as notas novas ficam neste aparelho e sobem quando a conexão voltar.',
  locked: 'Esta nota não está mais aberta, então não pode ser editada. Reabra primeiro.',
  empty: 'Nada aqui ainda.',
  loadError: 'Não deu para carregar as notas. Confira a conexão.',
  history: (n: number) => `Histórico · ${n}`,
  resolution: {
    summary: 'O que foi feito',
    done: 'Feito',
    ignored: 'Decidido não fazer',
    decisions: 'Decisões',
    follow_ups: 'Próximos passos',
    deployed: 'Publicado',
  },
  actors: { user: 'Você', claude: 'Claude' },
  actions: {
    created: 'criou',
    edited: 'editou',
    deleted: 'excluiu',
    reopened: 'reabriu',
    confirmed: 'confirmou que funciona 👍',
    rejected: 'disse que ainda não está pronto 👎',
    status: 'mudou o status',
    work: 'trabalhou nela',
  } as Record<string, string>,
  meta: (stage: string, version: string, screen: string | null) =>
    `${stage} · ${version}${screen ? ` · de ${screen}` : ''}`,
  shortcut: () => (onApple() ? '⌘↵ para adicionar' : 'Ctrl+↵ para adicionar'),
  close: 'Fechar',
  codeTitle: 'Código de acesso',
  codeHint:
    'Cole o código que está em ~/.markdown-viewer/feedback-access-code.txt. Ele fica guardado neste aparelho.',
  codeSave: 'Guardar',
  codeWrong: 'Esse código não foi aceito. Confira e tente de novo.',
}

const KINDS: Kind[] = ['bug', 'idea', 'ux', 'question']
const FILTERS: Filter[] = ['all', 'open', 'in_progress', 'done', 'ignored']
const KIND_COLOR: Record<Kind, string> = {
  bug: 'red',
  idea: 'yellow',
  ux: 'purple',
  question: 'cyan',
}
const STATUS_COLOR: Record<Status, string> = {
  open: 'gray',
  discussing: 'purple',
  in_progress: 'blue',
  done: 'green',
  ignored: 'gray',
  archived: 'teal',
}
const REPO = 'https://github.com/megomes/markdown-viewer/commit/'
const API: string =
  (import.meta.env.VITE_FEEDBACK_URL as string | undefined) ??
  'https://markdown-viewer-feedback.megomes.workers.dev'
const PENDING_KEY = 'markdown-viewer.pending-feedback'
const CODE_KEY = 'markdown-viewer.feedback-code'

const inFilter = (s: Status, f: Filter) =>
  s !== 'archived' && (f === 'all' || (f === 'open' ? s === 'open' || s === 'discussing' : s === f))
const findLast = <T,>(arr: T[], pred: (x: T) => boolean) => {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i
  return -1
}
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/** The desktop webview opens no new windows, so a link goes to the system browser. */
function openOutside(event: React.MouseEvent<HTMLAnchorElement>) {
  if (!isDesktop()) return
  event.preventDefault()
  const url = event.currentTarget.href
  void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url))
}

function readCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

function readPending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') as Pending[]
  } catch {
    return []
  }
}
function writePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list))
  } catch {
    // storage blocked
  }
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${readCode()}`,
      'x-device-id': deviceId(),
      ...init?.headers,
    },
  })
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T }
}

/** Sends notes written offline; returns the ones still waiting. */
async function flushPending(): Promise<Pending[]> {
  const left: Pending[] = []
  for (const p of readPending()) {
    try {
      // Written offline if the note waited more than a few seconds before being sent.
      const context = {
        ...p.context,
        writtenAt: p.createdAt,
        sentAt: new Date().toISOString(),
        queuedOffline: Date.now() - Date.parse(p.createdAt) > 10_000,
      }
      const r = await api('/feedback', {
        method: 'POST',
        body: JSON.stringify({
          body: p.body,
          kind: p.kind,
          screen: p.screen,
          clientId: p.clientId,
          context,
        }),
      })
      if (!r.ok) left.push(p)
    } catch {
      left.push(p)
    }
  }
  writePending(left)
  return left
}

interface Props {
  /** The kind of view that was open, and its file's extension: never a path. */
  screen: string
  onClose: () => void
}

export function Feedback({ screen, onClose }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState(false)
  const [denied, setDenied] = useState(() => !readCode())
  const [filter, setFilter] = useState<Filter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [nonce, setNonce] = useState(0)
  const reload = () => setNonce((n) => n + 1)

  useEffect(() => {
    if (denied) return
    let cancelled = false
    void (async () => {
      const left = await flushPending()
      try {
        const r = await api<{ notes: Note[] }>('/feedback')
        if (r.status === 401) {
          if (!cancelled) setDenied(true)
          return
        }
        if (!r.ok) throw new Error(String(r.status))
        if (!cancelled) {
          setNotes(r.data.notes)
          setError(false)
        }
      } catch {
        if (!cancelled) setError(true)
      }
      if (!cancelled) setPending(left)
    })()
    return () => {
      cancelled = true
    }
  }, [nonce, denied])

  useEffect(() => {
    const onOnline = () => setNonce((n) => n + 1)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // Escape closes the page, unless a text box inside it is being written in.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if ((event.target as HTMLElement | null)?.closest?.('.fb-page textarea, .fb-page input'))
        return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, open: 0, in_progress: 0, done: 0, ignored: 0 }
    for (const n of notes ?? [])
      FILTERS.forEach((f) => {
        if (inFilter(n.status, f)) c[f]++
      })
    return c
  }, [notes])

  const archivedCount = (notes ?? []).filter((n) => n.status === 'archived').length
  const shown = (notes ?? []).filter((n) =>
    showArchived ? n.status === 'archived' : inFilter(n.status, filter),
  )

  async function add(body: string, kind: Kind) {
    const context = await collectContext(screen)
    const p: Pending = {
      clientId: crypto.randomUUID(),
      body,
      kind,
      screen,
      createdAt: new Date().toISOString(),
      context,
    }
    writePending([...readPending(), p])
    setPending(readPending())
    reload()
  }

  return (
    <div className="fb-layer">
      <div className="fb-page page notes-page">
        <header className="page-head">
          <div>
            <h1>{m.title}</h1>
            <div className="sub">{m.subtitle}</div>
          </div>
          <button
            type="button"
            className="btn sm ghost"
            onClick={onClose}
            aria-label={m.close}
            title={`${m.close} (Esc)`}
          >
            <X size={14} />
          </button>
        </header>

        {denied ? (
          <AccessCode
            onSaved={() => {
              setDenied(false)
              reload()
            }}
            wrong={!!readCode()}
          />
        ) : (
          <>
            {!showArchived && <Composer onAdd={add} />}

            <div className="row wrap" style={{ margin: '18px 0 10px' }}>
              {showArchived ? (
                <>
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setShowArchived(false)}
                  >
                    <ArrowLeft size={14} />
                    {m.backToActive}
                  </button>
                  <span className="label">{m.archivedTitle}</span>
                </>
              ) : (
                <>
                  <div className="seg" role="group" aria-label="Filtro">
                    {FILTERS.map((f) => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={filter === f}
                        onClick={() => setFilter(f)}
                      >
                        {m.filters[f]} <span className="muted tabular">{counts[f]}</span>
                      </button>
                    ))}
                  </div>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => setShowArchived(true)}
                  >
                    <Archive size={14} />
                    {m.archived(archivedCount)}
                  </button>
                </>
              )}
            </div>

            {error && <p className="hint">{navigator.onLine ? m.loadError : m.offline}</p>}

            <div className="notes">
              {!showArchived &&
                pending.map((p) => (
                  <article key={p.clientId} className="card note pending">
                    <div className="note-head">
                      <span className="note-id mono">#…</span>
                      <span className="pill" data-color={KIND_COLOR[p.kind]}>
                        {m.kinds[p.kind]}
                      </span>
                      <span className="pill" data-color="yellow">
                        {m.pending}
                      </span>
                    </div>
                    <p className="note-body">{p.body}</p>
                  </article>
                ))}
              {notes && !shown.length && (showArchived || !pending.length) && (
                <p className="hint">{m.empty}</p>
              )}
              {shown.map((n) => (
                <NoteCard key={n.id} note={n} screen={screen} onChanged={reload} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AccessCode({ onSaved, wrong }: { onSaved: () => void; wrong: boolean }) {
  const [code, setCode] = useState('')
  const save = () => {
    const c = code.trim()
    if (!c) return
    try {
      localStorage.setItem(CODE_KEY, c)
    } catch {
      // storage blocked
    }
    onSaved()
  }
  return (
    <div className="card composer">
      <span className="label">{m.codeTitle}</span>
      <p className="hint" style={{ margin: 0 }}>
        {m.codeHint}
      </p>
      {wrong && (
        <p className="error" style={{ margin: 0 }}>
          {m.codeWrong}
        </p>
      )}
      <div className="row">
        <input
          className="input mono"
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
          aria-label={m.codeTitle}
        />
        <button type="button" className="btn sm primary" disabled={!code.trim()} onClick={save}>
          {m.codeSave}
        </button>
      </div>
    </div>
  )
}

function KindPicker({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  return (
    <div className="row wrap" role="group" aria-label="Tipo">
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className="chip"
          data-color={KIND_COLOR[k]}
          aria-pressed={value === k}
          onClick={() => onChange(k)}
        >
          <span className="dot" />
          {m.kinds[k]}
        </button>
      ))}
    </div>
  )
}

function Composer({ onAdd }: { onAdd: (body: string, kind: Kind) => void }) {
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<Kind>('idea')
  const submit = () => {
    const b = body.trim()
    if (!b) return
    onAdd(b, kind)
    setBody('')
  }
  return (
    <div className="card composer">
      <textarea
        className="input"
        rows={3}
        autoFocus
        placeholder={m.placeholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
        aria-label={m.placeholder}
      />
      <div className="row wrap">
        <KindPicker value={kind} onChange={setKind} />
        <span className="spacer" />
        <span className="hint">{m.shortcut()}</span>
        <button type="button" className="btn sm primary" disabled={!body.trim()} onClick={submit}>
          {m.add}
        </button>
      </div>
    </div>
  )
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <div className="res-block">
      <span className="label">{title}</span>
      <ul>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
}

function NoteCard({
  note,
  screen,
  onChanged,
}: {
  note: Note
  screen: string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(note.body)
  const [kind, setKind] = useState<Kind>(note.kind)
  const [armed, setArmed] = useState(false)
  const [msg, setMsg] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const r = note.resolution ?? {}
  const delivered = note.status === 'done' || note.status === 'ignored'
  // The user's latest 👎 comment, shown until Claude delivers again.
  const lastReject = findLast(note.log, (l) => l.action === 'rejected')
  const lastDelivery = findLast(
    note.log,
    (l) => l.action === 'status' && (l.detail?.status === 'done' || l.detail?.status === 'ignored'),
  )
  const feedback = lastReject > lastDelivery ? note.log[lastReject] : null
  const open = note.status === 'open'
  const hasResolution = !!(
    r.summary ||
    r.done?.length ||
    r.ignored?.length ||
    r.decisions?.length ||
    r.follow_ups?.length ||
    r.commits?.length ||
    r.deployed
  )
  const device = summarizeContext(note.context)

  async function save() {
    const res = await api(`/feedback/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: body.trim(), kind, context: await collectContext(screen) }),
    })
    if (res.status === 409) {
      setMsg(m.locked)
      return
    }
    setEditing(false)
    onChanged()
  }
  async function del() {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 4000)
      return
    }
    const res = await api(`/feedback/${note.id}`, { method: 'DELETE' })
    if (res.status === 409) {
      setMsg(m.locked)
      return
    }
    onChanged()
  }
  async function confirm() {
    await api(`/feedback/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'confirm', context: await collectContext(screen) }),
    })
    onChanged()
  }
  async function reject() {
    const c = comment.trim()
    if (!c) return
    await api(`/feedback/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reject', comment: c, context: await collectContext(screen) }),
    })
    setRejecting(false)
    setComment('')
    onChanged()
  }

  return (
    <article className={`card note s-${note.status}`} id={`note-${note.id}`}>
      <div className="note-head">
        <span className="note-id mono">#{note.id}</span>
        <span className="pill" data-color={KIND_COLOR[note.kind]}>
          {m.kinds[note.kind]}
        </span>
        <span className="pill" data-color={STATUS_COLOR[note.status]} data-status={note.status}>
          {m.status[note.status]}
        </span>
        <span className="hint tabular">{fmtWhen(note.createdAt)}</span>
        <span className="spacer" />
        {open && !editing && (
          <>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                setBody(note.body)
                setKind(note.kind)
                setEditing(true)
                setMsg('')
              }}
            >
              <Pencil size={13} />
              {m.edit}
            </button>
            <button
              type="button"
              className={`btn sm ghost${armed ? ' danger' : ''}`}
              onClick={() => void del()}
            >
              <Trash2 size={13} />
              {armed ? m.confirmDelete : m.delete}
            </button>
          </>
        )}
      </div>

      {device && (
        <div className="note-device hint">
          <MonitorSmartphone size={13} />
          {device}
        </div>
      )}

      {editing ? (
        <div className="note-edit">
          <textarea
            className="input"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void save()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(false)
              }
            }}
          />
          <div className="row wrap">
            <KindPicker value={kind} onChange={setKind} />
            <span className="spacer" />
            <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>
              {m.cancel}
            </button>
            <button
              type="button"
              className="btn sm primary"
              disabled={!body.trim()}
              onClick={() => void save()}
            >
              {m.save}
            </button>
          </div>
        </div>
      ) : (
        <p className="note-body">{note.body}</p>
      )}
      {msg && (
        <p className="error" style={{ margin: 0 }}>
          {msg}
        </p>
      )}

      {feedback && (
        <div className="feedback">
          <MessageSquareWarning size={15} />
          <div>
            <span className="label">
              {m.feedback} · {fmtWhen(feedback.ts)}
            </span>
            <p>{feedback.message}</p>
          </div>
        </div>
      )}

      {hasResolution && (
        <div className="resolution">
          {r.summary && (
            <div className="res-block">
              <span className="label">{m.resolution.summary}</span>
              <p>{r.summary}</p>
            </div>
          )}
          <List title={m.resolution.done} items={r.done} />
          <List title={m.resolution.ignored} items={r.ignored} />
          <List title={m.resolution.decisions} items={r.decisions} />
          <List title={m.resolution.follow_ups} items={r.follow_ups} />
          {(r.commits?.length || r.deployed) && (
            <div className="row wrap res-meta">
              {r.commits?.map((c) => (
                <a
                  key={c}
                  className="chip mono"
                  href={`${REPO}${c}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={openOutside}
                >
                  <GitCommitHorizontal size={13} />
                  {c.slice(0, 7)}
                </a>
              ))}
              {r.deployed && (
                <span className="hint">
                  {m.resolution.deployed}: {r.deployed}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {delivered && (
        <div className="verify">
          {!rejecting ? (
            <>
              <span className="label">{m.verify}</span>
              <span className="spacer" />
              <button
                type="button"
                className="btn sm thumb up"
                title={m.worksHint}
                aria-label={`${m.works}: ${m.worksHint}`}
                onClick={() => void confirm()}
              >
                <ThumbsUp size={15} />
                {m.works}
              </button>
              <button
                type="button"
                className="btn sm thumb down"
                title={m.notYetHint}
                aria-label={`${m.notYet}: ${m.notYetHint}`}
                onClick={() => setRejecting(true)}
              >
                <ThumbsDown size={15} />
                {m.notYet}
              </button>
            </>
          ) : (
            <div className="reject">
              <textarea
                className="input"
                rows={3}
                autoFocus
                placeholder={m.rejectPlaceholder}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void reject()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setRejecting(false)
                  }
                }}
              />
              <div className="row">
                <span className="spacer" />
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => {
                    setRejecting(false)
                    setComment('')
                  }}
                >
                  {m.cancel}
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={!comment.trim()}
                  onClick={() => void reject()}
                >
                  <ThumbsDown size={14} />
                  {m.rejectSend}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <details className="note-log">
        <summary>
          <ChevronRight size={13} />
          {m.history(note.log.length)}
          <span className="hint">
            {m.meta(note.stage ?? '', note.appVersion ?? '', note.screen)}
          </span>
        </summary>
        <ol>
          {note.log.map((l, i) => (
            <li key={i}>
              <span className="mono tabular muted">{fmtWhen(l.ts)}</span>
              <span className={`actor a-${l.actor}`}>{m.actors[l.actor]}</span>
              <span>
                {m.actions[l.action] ?? l.action}
                {l.detail?.status
                  ? ` → ${m.status[l.detail.status as Status] ?? String(l.detail.status)}`
                  : ''}
                {l.message ? `: ${l.message}` : ''}
              </span>
              {l.action === 'edited' && typeof l.detail?.from === 'string' && (
                <span className="log-prev">“{String(l.detail.from)}”</span>
              )}
            </li>
          ))}
        </ol>
        {note.context && Object.keys(note.context).length > 0 && (
          <details className="debug">
            <summary>Debug info</summary>
            <pre className="mono">{JSON.stringify(note.context, null, 2)}</pre>
          </details>
        )}
      </details>
    </article>
  )
}
