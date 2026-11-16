/**
 * An icon by the name the vault stores (`@markdown-viewer/core/icons`):
 * `LiBookOpen` is Lucide's BookOpen, anything else is drawn as text, which
 * covers emoji. The same names the desktop draws, so the tree looks the same.
 */

import type { ComponentType } from 'react'
import { Text } from 'react-native'
import * as Lucide from 'lucide-react-native'

type IconProps = { size?: number; color?: string; strokeWidth?: number }
const ALL = Lucide as unknown as Record<string, ComponentType<IconProps> | undefined>

/** Whether there is something to draw for this name. */
export function hasVaultIcon(name: string | undefined): name is string {
  if (!name) return false
  return !name.startsWith('Li') || typeof ALL[name.slice(2)] !== 'undefined'
}

export function VaultIcon({
  name,
  size = 18,
  color,
}: {
  name: string
  size?: number
  color: string
}) {
  if (!name.startsWith('Li')) {
    return <Text style={{ fontSize: size - 2, lineHeight: size + 2, color }}>{name}</Text>
  }
  const Icon = ALL[name.slice(2)]
  return Icon ? <Icon size={size} color={color} strokeWidth={1.75} /> : null
}
