/**
 * The environment in use, at the top of the sidebar, and the way to another one.
 * The button carries the environment's icon on its colour, and opens a list of
 * the others with the tabs each has open, then the whole vault, then the colour
 * of the one in use.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, ChevronsUpDown, Folder, Gem } from 'lucide-react'
import { ACCENTS, type Accent } from '~/app/environments'
import { NamedIcon } from './NamedIcon'

export interface EnvironmentItem {
  /** The folder at the root of the vault. */
  folder: string
  icon: string | null
  accent: Accent
  /** Tabs open in it. */
  tabs: number
}

interface Props {
  environments: EnvironmentItem[]
  /** The folder of the one in use, or null when the whole vault is showing. */
  active: string | null
  vaultName: string
  vaultTabs: number
  /** The keys that go to the one at this place of the list, for its tooltip. */
  shortcut: (index: number) => string | null
  onSelect: (folder: string | null) => void
  onColor: (folder: string, accent: Accent) => void
}

function Tile({ item }: { item: EnvironmentItem | null }) {
  const tint = item
    ? ({ '--tile-dark': item.accent.dark, '--tile-light': item.accent.light } as CSSProperties)
    : undefined
  return (
    <span className={'env-tile' + (item ? '' : ' is-vault')} style={tint}>
      {!item ? (
        <Gem size={14} strokeWidth={1.9} />
      ) : item.icon ? (
        <NamedIcon name={item.icon} className="env-tile-icon" />
      ) : (
        <Folder size={14} strokeWidth={1.9} />
      )}
    </span>
  )
}

export function EnvironmentSwitcher({
  environments,
  active,
  vaultName,
  vaultTabs,
  shortcut,
  onSelect,
  onColor,
}: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = environments.find((one) => one.folder === active) ?? null

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const choose = (folder: string | null) => {
    setOpen(false)
    onSelect(folder)
  }

  return (
    <div className="env" ref={box}>
      <button
        type="button"
        className={'env-button' + (open ? ' is-open' : '')}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Trocar de ambiente"
        onClick={() => setOpen(!open)}
      >
        <Tile item={current} />
        <span className="env-text">
          <span className="env-label">{current ? 'Ambiente' : 'Vault inteiro'}</span>
          <span className="env-name">{current ? current.folder : vaultName}</span>
        </span>
        <ChevronsUpDown size={14} strokeWidth={1.75} className="env-chevron" />
      </button>

      {open && (
        <div className="env-menu" role="listbox" aria-label="Ambientes">
          {environments.map((item, index) => (
            <button
              key={item.folder}
              type="button"
              role="option"
              aria-selected={item.folder === active}
              className={'env-option' + (item.folder === active ? ' is-active' : '')}
              title={shortcut(index) ? `${item.folder} (${shortcut(index)})` : item.folder}
              onClick={() => choose(item.folder)}
            >
              <Tile item={item} />
              <span className="env-option-name">{item.folder}</span>
              {item.tabs > 0 && <span className="env-option-count">{item.tabs}</span>}
              {item.folder === active && (
                <Check size={14} strokeWidth={2} className="env-option-check" />
              )}
            </button>
          ))}
          <div className="env-rule" />
          <button
            type="button"
            role="option"
            aria-selected={active === null}
            className={'env-option' + (active === null ? ' is-active' : '')}
            onClick={() => choose(null)}
          >
            <Tile item={null} />
            <span className="env-option-name">Vault inteiro</span>
            {vaultTabs > 0 && <span className="env-option-count">{vaultTabs}</span>}
            {active === null && <Check size={14} strokeWidth={2} className="env-option-check" />}
          </button>
          {current && (
            <>
              <div className="env-rule" />
              <p className="env-caption">Cor de {current.folder}</p>
              <div className="env-swatches" role="radiogroup" aria-label="Cor do ambiente">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent.id}
                    type="button"
                    role="radio"
                    aria-checked={accent.id === current.accent.id}
                    aria-label={accent.name}
                    title={accent.name}
                    className={'env-swatch' + (accent.id === current.accent.id ? ' is-on' : '')}
                    style={
                      { '--tile-dark': accent.dark, '--tile-light': accent.light } as CSSProperties
                    }
                    onClick={() => onColor(current.folder, accent)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
