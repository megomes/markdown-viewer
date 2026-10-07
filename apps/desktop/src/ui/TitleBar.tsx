/**
 * The window's own title bar, on Windows and Linux (note #4).
 *
 * The system's bar there is a white or black strip that knows nothing of the app,
 * with the menu in a second strip under it. Like VS Code, the window drops the
 * system frame and draws this instead: the mark, the menu (the same plan the Mac
 * gets as its menu bar), a stretch to drag the window by, and the three window
 * buttons, all in the colour of the app's frame.
 *
 * The menu never takes the focus: a press on it is cancelled before the browser
 * moves the focus, so Copy and Paste act on what was selected in the editor.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isDesktop } from '~/platform'
import type { CommandId, MenuNode } from './app-menu'
import { BrandMark } from './icons'

type Native = Extract<MenuNode, { kind: 'native' }>['item']

interface AppWindow {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  isFullscreen(): Promise<boolean>
  setFullscreen(on: boolean): Promise<void>
  onResized(handler: () => void): Promise<() => void>
}

async function appWindow(): Promise<AppWindow | null> {
  if (!isDesktop()) return null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow() as unknown as AppWindow
}

/** What the system's own menu items did, done from here. */
async function runNative(item: Native) {
  switch (item) {
    case 'Cut':
    case 'Copy':
      document.execCommand(item.toLowerCase())
      return
    case 'Paste': {
      // The page may not paste by itself; it reads the clipboard and types it in.
      const text = await navigator.clipboard.readText().catch(() => '')
      if (text) document.execCommand('insertText', false, text)
      return
    }
    case 'SelectAll':
      document.execCommand('selectAll')
      return
    case 'Quit': {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('quit_app')
      return
    }
  }
  const win = await appWindow()
  if (!win) return
  if (item === 'Minimize') await win.minimize()
  if (item === 'CloseWindow') await win.close()
  if (item === 'Fullscreen') await win.setFullscreen(!(await win.isFullscreen()))
}

/** "CmdOrCtrl+Shift+Z" as Windows writes it: "Ctrl+Shift+Z". */
function keys(accelerator: string | undefined): string | undefined {
  return accelerator
    ?.replace('CmdOrCtrl', 'Ctrl')
    .replace('Plus', '+')
    .replace('Comma', ',')
    .replace('Backslash', '\\')
}

/** Keeps the focus where it was: on the editor, with its selection. */
const keepFocus = (event: React.MouseEvent) => event.preventDefault()

interface PanelProps {
  nodes: MenuNode[]
  style: CSSProperties
  onPick: (node: MenuNode) => void
}

function MenuPanel({ nodes, style, onPick }: PanelProps) {
  const [open, setOpen] = useState<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [flyout, setFlyout] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (open === null || !panel.current) return
    const row = panel.current.children[open] as HTMLElement | undefined
    if (!row) return
    const box = row.getBoundingClientRect()
    setFlyout({ left: box.right + 2, top: box.top - 4 })
  }, [open])

  return (
    <>
      <div ref={panel} className="menu titlebar-panel" role="menu" style={style}>
        {nodes.map((node, index) => {
          if (node.kind === 'separator')
            return <div key={index} className="menu-rule" role="separator" />
          const submenu = node.kind === 'submenu'
          const disabled = node.kind === 'item' && node.enabled === false
          return (
            <button
              key={index}
              type="button"
              role="menuitem"
              className={'menu-item' + (open === index ? ' is-open' : '')}
              disabled={disabled}
              aria-haspopup={submenu || undefined}
              onMouseDown={keepFocus}
              onMouseEnter={() => setOpen(submenu ? index : null)}
              onClick={() => (submenu ? setOpen(index) : onPick(node))}
            >
              <span>{node.label}</span>
              {submenu ? (
                <span className="menu-hint">›</span>
              ) : node.kind === 'item' && node.accelerator ? (
                <kbd className="menu-hint">{keys(node.accelerator)}</kbd>
              ) : null}
            </button>
          )
        })}
      </div>
      {open !== null && nodes[open]?.kind === 'submenu' && (
        <MenuPanel
          nodes={(nodes[open] as Extract<MenuNode, { kind: 'submenu' }>).items}
          style={flyout}
          onPick={onPick}
        />
      )}
    </>
  )
}

interface Props {
  plan: MenuNode[]
  run: (command: CommandId) => void
}

export function TitleBar({ plan, run }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  // Where the open menu hangs from: taken from its button when it opens.
  const [box, setBox] = useState<DOMRect | null>(null)
  const show = (index: number, button: HTMLElement) => {
    setBox(button.getBoundingClientRect())
    setOpen(index)
  }
  const [maximized, setMaximized] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const menus = plan.filter((node) => node.kind === 'submenu')

  // The shell leaves room for the bar only while it is there.
  useEffect(() => {
    const root = document.documentElement.dataset
    root.titlebar = 'custom'
    // Only the Windows window is created transparent (tauri.windows.conf.json),
    // so only there does the interface draw the rounded corners itself.
    if (/Windows/.test(navigator.userAgent)) root.transparent = 'true'
    return () => {
      delete root.titlebar
      delete root.transparent
    }
  }, [])

  // The middle button shows restore while the window fills the screen.
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void appWindow().then(async (win) => {
      if (!win || cancelled) return
      const check = () =>
        void win.isMaximized().then((on) => {
          setMaximized(on)
          // A maximised window has square corners, like any other.
          if (on) document.documentElement.dataset.maximized = 'true'
          else delete document.documentElement.dataset.maximized
        })
      check()
      stop = await win.onResized(check)
      if (cancelled) stop()
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  // A press anywhere else, Escape, or leaving the window closes an open menu.
  useEffect(() => {
    if (open === null) return
    const close = (event: Event) => {
      if (event instanceof PointerEvent && bar.current?.contains(event.target as Node)) return
      if (event instanceof PointerEvent && (event.target as Element).closest?.('.titlebar-panel'))
        return
      setOpen(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (node: MenuNode) => {
    setOpen(null)
    if (node.kind === 'item') run(node.command)
    if (node.kind === 'native') void runNative(node.item)
  }

  // The open menu is drawn beside the bar and not inside it: inside, the gaps
  // between its items would count as the bar and drag the window.
  return (
    <>
      <header ref={bar} className="titlebar" data-drag-window>
        <span className="titlebar-mark" aria-hidden="true">
          <BrandMark size={16} />
        </span>
        <nav className="titlebar-menus" aria-label="Menu">
          {menus.map((node, index) => (
            <button
              key={node.label}
              type="button"
              className={'titlebar-menu' + (open === index ? ' is-open' : '')}
              aria-haspopup="menu"
              aria-expanded={open === index}
              onMouseDown={keepFocus}
              onClick={(event) =>
                open === index ? setOpen(null) : show(index, event.currentTarget)
              }
              // Once a menu is open, moving along the bar opens the next one.
              onMouseEnter={(event) => open !== null && show(index, event.currentTarget)}
            >
              {node.label}
            </button>
          ))}
        </nav>
        <div className="titlebar-fill" />
        <div className="titlebar-controls">
          <button
            type="button"
            className="titlebar-control"
            aria-label="Minimizar"
            title="Minimizar"
            onClick={() => void appWindow().then((win) => win?.minimize())}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5h10" />
            </svg>
          </button>
          <button
            type="button"
            className="titlebar-control"
            aria-label={maximized ? 'Restaurar' : 'Maximizar'}
            title={maximized ? 'Restaurar' : 'Maximizar'}
            onClick={() => void appWindow().then((win) => win?.toggleMaximize())}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              {maximized ? (
                <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />
              ) : (
                <path d="M.5.5h9v9h-9z" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="titlebar-control is-close"
            aria-label="Fechar"
            title="Fechar"
            onClick={() => void appWindow().then((win) => win?.close())}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M.5.5l9 9M9.5.5l-9 9" />
            </svg>
          </button>
        </div>
      </header>
      {open !== null && box && menus[open]?.kind === 'submenu' && (
        <MenuPanel
          key={open}
          nodes={(menus[open] as Extract<MenuNode, { kind: 'submenu' }>).items}
          style={{ left: box.left, top: box.bottom + 2 }}
          onPick={pick}
        />
      )}
    </>
  )
}
