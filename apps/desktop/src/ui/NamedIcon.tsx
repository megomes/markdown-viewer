/**
 * An icon by the name Iconize stores: `LiPlane` is Lucide's `Plane`, anything
 * else is drawn as text, which covers emoji. Lucide's whole set is loaded only
 * the first time a vault asks for one, and kept.
 */

import { useEffect, useState, type ComponentType } from 'react'

type LucideIcon = ComponentType<{ size?: number; className?: string; strokeWidth?: number }>
let loaded: Record<string, LucideIcon> | null = null
let loading: Promise<Record<string, LucideIcon>> | null = null

function loadIcons(): Promise<Record<string, LucideIcon>> {
  loading ??= import('lucide-react').then((module) => {
    loaded = module.icons as unknown as Record<string, LucideIcon>
    return loaded
  })
  return loading
}

export function NamedIcon({ name, className }: { name: string; className?: string }) {
  const [icons, setIcons] = useState(loaded)
  const lucide = name.startsWith('Li') ? name.slice(2) : null

  useEffect(() => {
    if (lucide && !icons) void loadIcons().then(setIcons)
  }, [lucide, icons])

  if (!lucide) return <span className={className + ' is-emoji'}>{name}</span>
  const Icon = icons?.[lucide]
  if (!Icon) return <span className={className} />
  return <Icon size={15} strokeWidth={1.75} className={className} />
}
