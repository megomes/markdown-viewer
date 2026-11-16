/**
 * An icon by the name Iconize stores: `LiBookOpen` is Lucide's `book-open`,
 * anything else is drawn as text, which covers emoji. Each Lucide icon is
 * loaded on its own the first time it is needed, so the app does not carry the
 * whole set.
 */

import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic'
import { iconizeName, lucideName as guessed } from '@markdown-viewer/core/icons'

/** Every Lucide icon by the name Iconize gives it: exact, where a rule could miss. */
let known: Map<string, string> | null = null

/** `LiBookOpen` to `book-open`, `LiPlane` to `plane`. */
export function lucideName(name: string): string | null {
  if (!name.startsWith('Li')) return null
  known ??= new Map((iconNames as string[]).map((icon) => [iconizeName(icon), icon]))
  return known.get(name) ?? guessed(name)
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
