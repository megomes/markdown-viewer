/**
 * The spaces, as tabs at the top of the sidebar: the vault (with the state of
 * its sync), each other folder, and "Arquivos" when files from outside are open.
 */

import { Cloud, CloudAlert, CloudOff, FileText, Folder, Gem, RefreshCw, X } from 'lucide-react'
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
}

function SyncMark({ status }: { status: SyncStatus }) {
  const props = { size: 12, strokeWidth: 2, className: 'space-sync is-' + status }
  if (status === 'syncing') return <RefreshCw {...props} />
  if (status === 'error') return <CloudAlert {...props} />
  if (status === 'off' || status === 'offline') return <CloudOff {...props} />
  return <Cloud {...props} />
}

export function SpaceStrip({ spaces, active, counts, syncStatus, onSelect, onClose }: Props) {
  if (spaces.length < 2 && spaces[0]?.kind === 'vault' && !spaces[0].baseId) return null
  return (
    <div className="spaces" role="tablist" aria-label="Espaços">
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
    </div>
  )
}
