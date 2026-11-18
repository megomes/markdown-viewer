/** The desktop's dark tokens (apps/desktop/src/ui/design-system.css), for native screens. */
export const colors = {
  bgApp: '#050508',
  bgSidebar: '#0c0c17',
  bgContent: '#0a0a14',
  surface1: '#11111e',
  surface2: '#161627',
  surface3: '#1c1c31',
  surfaceHover: '#1f1f37',
  borderSubtle: '#1b1b2b',
  borderDefault: '#262639',
  textPrimary: '#f4f4f8',
  textSecondary: '#a7a7b9',
  textTertiary: '#6e6e82',
  textDisabled: '#4c4c5e',
  /** Folders in the tree, as on the desktop. */
  toneBlue: '#7f9fe0',
  /** The indigo light at the top of the desktop's panels. */
  glow: 'rgba(98, 92, 230, 0.2)',
  accent: '#ff4d4f',
  accentText: '#ff7b7d',
  green: '#3ecf8e',
}

export const radius = { sm: 6, md: 8, lg: 10, xl: 15 }

/** The desktop's sidebar: its colour with the indigo light at the top. */
export const sidebarBackground = {
  backgroundColor: colors.bgSidebar,
  backgroundImage: `radial-gradient(120% 28% at 20% 0%, ${colors.glow}, transparent 70%)`,
} as const
