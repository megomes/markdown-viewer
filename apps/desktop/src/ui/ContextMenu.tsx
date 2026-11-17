import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'

export interface MenuItem {
  label: string
  /** Not needed for an item that only opens `submenu`. */
  onSelect?: () => void
  /** Drawn at the start of the row, as Obsidian's menus do. */
  icon?: LucideIcon
  /** Opens beside the item on hover, as "Copy path" does in Obsidian. */
  submenu?: MenuItem[]
  /** Drawn apart from the rest, in the warning colour. */
  destructive?: boolean
  disabled?: boolean
  /** A rule is drawn above this item. */
  separated?: boolean
  hint?: string
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const dismiss = () => onClose()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [onClose])

  return <Panel x={x} y={y} items={items} onClose={onClose} />
}

/** One card of items: the menu itself, or a submenu beside one of its rows. */
function Panel({
  x,
  y,
  items,
  onClose,
  beside,
}: Props & {
  /** The row a submenu hangs from: it flips to the left of it if needed. */ beside?: DOMRect
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<{ index: number; box: DOMRect } | null>(null)
  const [placement, setPlacement] = useState<CSSProperties>({
    left: x,
    top: y,
    visibility: 'hidden',
  })
  const withIcons = items.some((item) => item.icon)

  // Measured and nudged back inside the window before it is shown, so a menu
  // opened near an edge never falls off it.
  useLayoutEffect(() => {
    const element = menu.current
    if (!element) return
    const margin = 8
    const width = element.offsetWidth
    const left =
      beside && x + width > window.innerWidth - margin
        ? Math.max(margin, beside.left - width + 4)
        : Math.min(x, window.innerWidth - width - margin)
    setPlacement({ left, top: Math.min(y, window.innerHeight - element.offsetHeight - margin) })
  }, [x, y, beside])

  return (
    <>
      <div
        ref={menu}
        className="menu"
        style={placement}
        role="menu"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? open?.index === index : undefined}
              className={
                'menu-item' +
                (item.destructive ? ' is-destructive' : '') +
                (item.separated ? ' is-separated' : '') +
                (open?.index === index ? ' is-open' : '')
              }
              disabled={item.disabled}
              onPointerEnter={(event) =>
                setOpen(
                  item.submenu && !item.disabled
                    ? { index, box: event.currentTarget.getBoundingClientRect() }
                    : null,
                )
              }
              onClick={(event) => {
                if (item.submenu) {
                  setOpen({ index, box: event.currentTarget.getBoundingClientRect() })
                  return
                }
                onClose()
                item.onSelect?.()
              }}
            >
              <span className="menu-label">
                {Icon ? (
                  <Icon size={14} strokeWidth={1.75} className="menu-icon" aria-hidden />
                ) : withIcons ? (
                  <span className="menu-icon" />
                ) : null}
                {item.label}
              </span>
              {item.submenu ? (
                <ChevronRight size={13} className="menu-hint" aria-hidden />
              ) : (
                item.hint && <kbd className="menu-hint">{item.hint}</kbd>
              )}
            </button>
          )
        })}
      </div>
      {open && items[open.index]?.submenu && (
        <Panel
          x={open.box.right + 2}
          y={open.box.top - 4}
          beside={open.box}
          items={items[open.index]!.submenu!}
          onClose={onClose}
        />
      )}
    </>
  )
}
