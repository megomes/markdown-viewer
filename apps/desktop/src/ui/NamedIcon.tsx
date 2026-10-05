/**
 * An icon by the name Iconize stores: `LiBookOpen` is Lucide's `book-open`,
 * anything else is drawn as text, which covers emoji. Each Lucide icon is
 * loaded on its own the first time it is needed, so the app does not carry the
 * whole set.
 */

import { DynamicIcon, type IconName } from 'lucide-react/dynamic'

/** `LiBookOpen` to `book-open`, `LiPlane` to `plane`. */
export function lucideName(name: string): string | null {
  if (!name.startsWith('Li')) return null
  return name
    .slice(2)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

export function NamedIcon({ name, className }: { name: string; className?: string }) {
  const lucide = lucideName(name)
  if (!lucide) return <span className={className + ' is-emoji'}>{name}</span>
  return (
    <DynamicIcon
      name={lucide as IconName}
      size={15}
      strokeWidth={1.75}
      className={className}
      fallback={() => <span className={className} />}
    />
  )
}
