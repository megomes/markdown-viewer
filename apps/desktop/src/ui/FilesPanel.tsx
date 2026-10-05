/**
 * The sidebar of the "Arquivos" space: the files opened from outside any
 * folder, with the place each one lives, and the way to bring one into the vault.
 */

import { FileText, FolderInput } from 'lucide-react'
import type { Tab } from '~/app/store'

interface Props {
  tabs: Tab[]
  activeId: string | null
  canMoveToVault: boolean
  onActivate: (id: string) => void
  onMoveToVault: (tab: Tab) => void
  onOpenFile: () => void
}

export function FilesPanel({
  tabs,
  activeId,
  canMoveToVault,
  onActivate,
  onMoveToVault,
  onOpenFile,
}: Props) {
  return (
    <div className="files-panel">
      <p className="files-note">Arquivos abertos de fora do vault. Não sincronizam.</p>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.id} className={tab.id === activeId ? 'is-active' : ''}>
            <button
              type="button"
              className="files-open"
              title={tab.label ?? tab.name}
              onClick={() => onActivate(tab.id)}
            >
              <FileText size={14} strokeWidth={1.75} />
              <span>
                <b>{tab.name}</b>
                <small>{tab.label ?? ''}</small>
              </span>
            </button>
            {canMoveToVault && (
              <button
                type="button"
                className="files-move"
                title="Mover para o vault: vai para a raiz do vault e passa a sincronizar. O original vai para a lixeira."
                onClick={() => onMoveToVault(tab)}
              >
                <FolderInput size={14} strokeWidth={1.75} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="nav-action" onClick={onOpenFile}>
        Abrir arquivo
      </button>
    </div>
  )
}
