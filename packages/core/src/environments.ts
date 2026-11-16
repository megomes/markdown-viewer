/**
 * Environments, the part the desktop and the phone share: which folders at the
 * root of a vault are environments, and the colour of each. See the desktop's
 * `app/environments.ts` for what an environment is.
 */

export interface EnvironmentsConfig {
  /** Root folders that are not environments, by name. */
  skip: string[]
  /** Folder name to the id of one of `ACCENTS`. */
  colors: Record<string, string>
}

export interface Accent {
  id: string
  name: string
  /** The colour itself, on a dark and on a light background. */
  dark: string
  light: string
}

/** The first is the app's own red, and what an environment has until one is chosen. */
export const ACCENTS: Accent[] = [
  { id: 'red', name: 'Vermelho', dark: '#ff4d4f', light: '#e5383b' },
  { id: 'orange', name: 'Laranja', dark: '#ff8a3d', light: '#d9631a' },
  { id: 'amber', name: 'Âmbar', dark: '#f5b83d', light: '#b7791f' },
  { id: 'green', name: 'Verde', dark: '#3ecf8e', light: '#1f9d62' },
  { id: 'teal', name: 'Turquesa', dark: '#2dd4bf', light: '#0f8f84' },
  { id: 'blue', name: 'Azul', dark: '#4c9aff', light: '#2f6fe0' },
  { id: 'violet', name: 'Violeta', dark: '#a78bfa', light: '#7350e0' },
  { id: 'pink', name: 'Rosa', dark: '#f472b6', light: '#d23a8a' },
]

export function accentOf(id: string | undefined): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0]!
}

/** Tolerant: a file that is missing, empty or half written is no configuration. */
export function parseEnvironments(text: string): EnvironmentsConfig {
  const empty: EnvironmentsConfig = { skip: [], colors: {} }
  try {
    const data = JSON.parse(text) as Partial<EnvironmentsConfig> | null
    if (!data || typeof data !== 'object') return empty
    const colors: Record<string, string> = {}
    for (const [folder, color] of Object.entries(data.colors ?? {})) {
      if (typeof color === 'string') colors[folder] = color
    }
    return {
      skip: Array.isArray(data.skip) ? data.skip.filter((one) => typeof one === 'string') : [],
      colors,
    }
  } catch {
    return empty
  }
}

/** Where the attachments of an environment (or of the vault, at its root) go. */
export const ATTACHMENTS = 'Files'

/**
 * The environments among the folders at the root of a vault: every one of them,
 * less the hidden ones, the attachments folder and those the person set aside.
 */
export function environmentsOf(rootFolders: string[], config: EnvironmentsConfig): string[] {
  return rootFolders
    .filter(
      (name) =>
        !name.startsWith('.') &&
        !name.startsWith('_') &&
        name !== ATTACHMENTS &&
        !config.skip.includes(name),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}
