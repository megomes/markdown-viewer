/**
 * Choosing the icon of a folder or a file: every Lucide icon, found by name in
 * English or by a few everyday words in Portuguese, or an emoji typed in.
 */

import { useMemo, useState } from 'react'
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic'
import { iconizeName } from '@markdown-viewer/core/icons'
import { lucideName } from './NamedIcon'

interface Props {
  /** What is getting the icon, for the title. */
  name: string
  current: string | null
  onPick: (icon: string | null) => void
  onClose: () => void
}

/** Shown before anything is typed: the ones a vault of notes reaches for. */
const SUGGESTED = [
  'folder',
  'folder-open',
  'user',
  'users',
  'briefcase',
  'house',
  'inbox',
  'archive',
  'book',
  'book-open',
  'bookmark',
  'library',
  'notebook',
  'file-text',
  'pencil',
  'calendar',
  'clock',
  'target',
  'flag',
  'star',
  'heart',
  'lightbulb',
  'rocket',
  'layers',
  'box',
  'package',
  'database',
  'server',
  'terminal',
  'code',
  'settings',
  'wrench',
  'search',
  'map-pin',
  'compass',
  'globe',
  'plane',
  'car',
  'music',
  'film',
  'camera',
  'image',
  'paperclip',
  'gamepad-2',
  'dumbbell',
  'trophy',
  'shopping-cart',
  'wallet',
  'chart-line',
  'scale',
  'message-square',
  'mail',
  'phone',
  'flame',
  'zap',
  'sun',
  'moon',
  'leaf',
  'coffee',
  'graduation-cap',
  'stethoscope',
  'shield',
  'lock',
  'key',
  'copy',
  'clipboard-list',
] as const

/** Everyday words to the English the icons are named in. */
const WORDS: Record<string, string> = {
  pasta: 'folder',
  arquivo: 'file',
  nota: 'notebook',
  livro: 'book',
  biblioteca: 'library',
  casa: 'house',
  pessoa: 'user',
  pessoas: 'users',
  usuario: 'user',
  trabalho: 'briefcase',
  projeto: 'layers',
  projetos: 'layers',
  reuniao: 'calendar',
  calendario: 'calendar',
  relogio: 'clock',
  tempo: 'clock',
  estrela: 'star',
  coracao: 'heart',
  ideia: 'lightbulb',
  foguete: 'rocket',
  caixa: 'box',
  banco: 'database',
  dados: 'database',
  servidor: 'server',
  codigo: 'code',
  ajustes: 'settings',
  configuracao: 'settings',
  ferramenta: 'wrench',
  busca: 'search',
  mapa: 'map',
  mundo: 'globe',
  aviao: 'plane',
  voo: 'plane',
  carro: 'car',
  musica: 'music',
  filme: 'film',
  foto: 'camera',
  imagem: 'image',
  anexo: 'paperclip',
  jogo: 'gamepad',
  esporte: 'dumbbell',
  treino: 'dumbbell',
  trofeu: 'trophy',
  compras: 'shopping',
  dinheiro: 'wallet',
  grafico: 'chart',
  decisao: 'scale',
  mensagem: 'message',
  email: 'mail',
  telefone: 'phone',
  fogo: 'flame',
  raio: 'zap',
  sol: 'sun',
  lua: 'moon',
  folha: 'leaf',
  cafe: 'coffee',
  estudo: 'graduation',
  saude: 'stethoscope',
  seguranca: 'shield',
  cadeado: 'lock',
  chave: 'key',
  lista: 'list',
  tarefa: 'check',
  alvo: 'target',
  meta: 'target',
  bandeira: 'flag',
  entrada: 'inbox',
  lixo: 'trash',
  nuvem: 'cloud',
  robo: 'bot',
  cerebro: 'brain',
  bussola: 'compass',
}

const plain = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const LIMIT = 120

export function IconPicker({ name, current, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [emoji, setEmoji] = useState('')
  const chosen = current ? lucideName(current) : null

  const found = useMemo(() => {
    const typed = plain(query)
    if (!typed) return SUGGESTED.filter((one) => (iconNames as string[]).includes(one))
    const wanted = typed.split(/\s+/).map((word) => WORDS[word] ?? word)
    const all = iconNames as string[]
    const starts = all.filter((icon) => wanted.every((word) => icon.startsWith(word)))
    const has = all.filter(
      (icon) => !starts.includes(icon) && wanted.every((word) => icon.includes(word)),
    )
    return [...starts, ...has].slice(0, LIMIT)
  }, [query])

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette icon-picker"
        role="dialog"
        aria-label={'Ícone de ' + name}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder={`Ícone de ${name}: livro, avião, folder, star…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && found[0]) onPick(iconizeName(found[0]))
          }}
        />
        <div className="icon-grid" role="listbox" aria-label="Ícones">
          {found.map((icon) => (
            <button
              key={icon}
              type="button"
              role="option"
              aria-selected={icon === chosen}
              className={'icon-cell' + (icon === chosen ? ' is-on' : '')}
              title={icon}
              onClick={() => onPick(iconizeName(icon))}
            >
              <DynamicIcon
                name={icon as IconName}
                size={18}
                strokeWidth={1.75}
                fallback={() => <span className="icon-cell-wait" />}
              />
            </button>
          ))}
          {found.length === 0 && <p className="palette-empty">Nenhum ícone com esse nome.</p>}
        </div>
        <div className="icon-foot">
          <input
            className="icon-emoji"
            placeholder="ou um emoji"
            aria-label="Emoji"
            value={emoji}
            maxLength={8}
            onChange={(e) => setEmoji(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && emoji.trim()) onPick(emoji.trim())
              if (e.key === 'Escape') onClose()
            }}
          />
          <button
            type="button"
            className="viewer-action"
            disabled={!emoji.trim()}
            onClick={() => onPick(emoji.trim())}
          >
            Usar emoji
          </button>
          <span className="icon-foot-space" />
          <button
            type="button"
            className="viewer-action"
            disabled={!current}
            onClick={() => onPick(null)}
          >
            Tirar o ícone
          </button>
        </div>
      </div>
    </div>
  )
}
