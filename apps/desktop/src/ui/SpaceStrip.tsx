/**
 * The spaces, as tabs at the top of the sidebar: the vault (with the state of
 * its sync), each other folder, and "Arquivos" when files from outside are open,
 * then a "+" to open another folder or a loose file.
 *
 * The strip never wraps (note #1): it tells the sidebar how wide it needs to be,
 * through `--sidebar-min`, and the sidebar does not get narrower than that. Past a
 * cap (many folders, long names) the strip scrolls sideways instead.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react'

import {
  Cloud,
  CloudAlert,
  CloudOff,
  FileText,
  Folder,
  Gem,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import type { Space, SpaceId } from '~/app/spaces'
import type { SyncStatus } from '~/app/sync'

interface Props {
  spaces: Space[]
  active: SpaceId
  /** Tabs open in each space, for the count on the tab. */
  counts: Partial<Record<SpaceId, number>>
  syncStatus: SyncStatus
  onSelect: (id: SpaceId) => void
  onClose: (space: Space) => void
  /** The "+": the caller shows what can be opened, under the button. */
  onAdd: (anchor: DOMRect) => void
}

/** Beyond this the sidebar stops growing for the strip, which scrolls instead. */
const MAX_MIN = 360

/** Sets `--sidebar-min` to what the strip needs on one line, and keeps it current. */
function useMinimumWidth(strip: RefObject<HTMLDivElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = strip.current
    const root = document.documentElement.style
    if (!el) {
      root.removeProperty('--sidebar-min')
      return
    }
    const measure = () => {
      const sidebar = el.closest('.sidebar')
      const pad = sidebar
        ? (() => {
            const css = getComputedStyle(sidebar)
            return (
              parseFloat(css.paddingLeft) +
              parseFloat(css.paddingRight) +
              parseFloat(css.borderLeftWidth) +
              parseFloat(css.borderRightWidth)
            )
          })()
        : 0
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0
      const pills = [...el.children] as HTMLElement[]
      const width =
        pills.reduce((sum, pill) => sum + pill.getBoundingClientRect().width, 0) +
        gap * Math.max(0, pills.length - 1)
      root.setProperty('--sidebar-min', Math.min(MAX_MIN, Math.ceil(width + pad)) + 'px')
    }
    measure()
    // The pills change size with the interface scale and the fonts loading.
    const observer = new ResizeObserver(measure)
    for (const pill of el.children) observer.observe(pill)
    return () => observer.disconnect()
  }, [strip, key])
}

function SyncMark({ status }: { status: SyncStatus }) {
  const props = { size: 12, strokeWidth: 2, className: 'space-sync is-' + status }
  if (status === 'syncing') return <RefreshCw {...props} />
  if (status === 'error') return <CloudAlert {...props} />
  if (status === 'off' || status === 'offline') return <CloudOff {...props} />
  return <Cloud {...props} />
}

export function SpaceStrip({
  spaces,
  active,
  counts,
  syncStatus,
  onSelect,
  onClose,
  onAdd,
}: Props) {
  const strip = useRef<HTMLDivElement>(null)
  const hidden = spaces.length < 2 && spaces[0]?.kind === 'vault' && !spaces[0].baseId
  useMinimumWidth(
    strip,
    hidden ? '' : spaces.map((space) => space.id + space.name).join('|') + JSON.stringify(counts),
  )
  if (hidden) return null
  return (
    <div className="spaces" role="tablist" aria-label="Espaços" ref={strip}>
      {spaces.map((space) => (
        <div
          key={space.id}
          role="tab"
          tabIndex={0}
          aria-selected={space.id === active}
          className={'space' + (space.id === active ? ' is-active' : '') + ' is-' + space.kind}
          title={space.label}
          onClick={() => onSelect(space.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onSelect(space.id)
          }}
        >
          {space.kind === 'vault' ? (
            <Gem size={13} strokeWidth={1.75} />
          ) : space.kind === 'folder' ? (
            <Folder size={13} strokeWidth={1.75} />
          ) : (
            <FileText size={13} strokeWidth={1.75} />
          )}
          <span className="space-name">{space.name}</span>
          {space.kind === 'vault' && space.baseId && <SyncMark status={syncStatus} />}
          {space.kind === 'files' && counts.files ? (
            <span className="space-count">{counts.files}</span>
          ) : null}
          {space.kind === 'folder' && (
            <button
              type="button"
              className="space-close"
              aria-label={'Fechar ' + space.name}
              title="Fechar esta pasta (os arquivos ficam no disco)"
              onClick={(event) => {
                event.stopPropagation()
                onClose(space)
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="space space-add"
        aria-label="Abrir pasta ou arquivo"
        title="Abrir outra pasta ou um arquivo avulso"
        onClick={(event) => onAdd(event.currentTarget.getBoundingClientRect())}
      >
        <Plus size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
