/**
 * Snapshot of the environment a feedback note was written in, for debugging:
 * device, surface (desktop app vs browser), layout, screen, network, app state.
 * Every field is best-effort; unsupported APIs are simply omitted.
 *
 * Port of `web/src/lib/clientContext.ts` from DailyFlow (commit 3fd41c3). What
 * changed is only what this app is: the surface is the Tauri app or a browser,
 * there is no sync yet, and `from` names the kind of view that was open and the
 * extension of its file, never the file's path or name.
 */

import { isDesktop } from '~/platform'

/** The stage of docs/spec.md being built, recorded with every note. */
export const STAGE = 'etapa-5'

const DEVICE_KEY = 'markdown-viewer.device-id'

export interface ClientContext {
  device: {
    kind: string
    os: string
    browser: string
    surface: 'desktop-tauri' | 'browser'
    layout: 'mobile' | 'desktop'
    touchPoints: number
    pointer: 'coarse' | 'fine'
    memoryGb?: number
    cores?: number
  }
  screen: {
    viewport: string
    screen: string
    dpr: number
    orientation?: string
    theme: string
    reducedMotion: boolean
  }
  network: {
    online: boolean
    type?: string
    downlinkMbps?: number
    rttMs?: number
    saveData?: boolean
  }
  locale: { language: string; timezone: string; localTime: string }
  app: {
    version: string
    stage: string
    from: string
    sync: string
    pendingChanges: number
    lastSync: string | null
    storageMb?: number
  }
  deviceId: string
  userAgent: string
}

/** One id per install, kept in this window's storage. */
export function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY)
    if (known) return known
    const made = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, made)
    return made
  } catch {
    return 'unknown'
  }
}

export function deviceKind(): 'phone' | 'tablet' | 'desktop' {
  const w = Math.min(window.screen.width, window.innerWidth || window.screen.width)
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  if (coarse && w < 700) return 'phone'
  if (coarse) return 'tablet'
  return 'desktop'
}

function os(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Mac OS X/.test(ua)) return navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Linux/.test(ua)) return 'Linux'
  return 'unknown'
}

function browser(ua: string): string {
  const pick = (name: string, re: RegExp) => {
    const m = ua.match(re)
    return m ? `${name} ${m[1]}` : null
  }
  return (
    pick('Edge', /Edg\/(\d+)/) ??
    pick('Samsung Internet', /SamsungBrowser\/(\d+)/) ??
    pick('Firefox', /(?:Firefox|FxiOS)\/(\d+)/) ??
    pick('Chrome', /(?:Chrome|CriOS)\/(\d+)/) ??
    pick('Safari', /Version\/(\d+(?:\.\d+)?).*Safari/) ??
    pick('WebKit', /AppleWebKit\/(\d+)/) ??
    'unknown'
  )
}

export async function collectContext(from: string): Promise<ClientContext> {
  const ua = navigator.userAgent
  const mm = (q: string) => window.matchMedia(q).matches
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
    deviceMemory?: number
  }
  const conn = nav.connection
  let storageMb: number | undefined
  try {
    const est = await navigator.storage?.estimate?.()
    if (typeof est?.usage === 'number') storageMb = Math.round((est.usage / 1024 / 1024) * 10) / 10
  } catch {
    // unsupported
  }

  return {
    device: {
      kind: deviceKind(),
      os: os(ua),
      browser: browser(ua),
      surface: isDesktop() ? 'desktop-tauri' : 'browser',
      layout: mm('(max-width: 820px)') ? 'mobile' : 'desktop',
      touchPoints: navigator.maxTouchPoints ?? 0,
      pointer: mm('(pointer: coarse)') ? 'coarse' : 'fine',
      memoryGb: nav.deviceMemory,
      cores: navigator.hardwareConcurrency,
    },
    screen: {
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      screen: `${window.screen.width}×${window.screen.height}`,
      dpr: window.devicePixelRatio,
      orientation: window.screen.orientation?.type,
      theme: document.documentElement.dataset.theme ?? 'dark',
      reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    },
    network: {
      online: navigator.onLine,
      type: conn?.effectiveType,
      downlinkMbps: conn?.downlink,
      rttMs: conn?.rtt,
      saveData: conn?.saveData,
    },
    locale: {
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localTime: new Date().toString().slice(0, 33),
    },
    app: {
      version: __APP_VERSION__,
      stage: STAGE,
      from: from || 'direct',
      // The sync arrives in stage 6 of the spec.
      sync: 'none',
      pendingChanges: 0,
      lastSync: null,
      storageMb,
    },
    deviceId: deviceId(),
    userAgent: ua,
  }
}

/** One-line human summary: "Desktop · Windows · Edge 141 · App desktop · 1440×900 · 4g · dark". */
export function summarizeContext(c: Partial<ClientContext> | null | undefined): string {
  if (!c?.device) return ''
  const kinds: Record<string, string> = { phone: 'Celular', tablet: 'Tablet', desktop: 'Desktop' }
  const kind = kinds[c.device.kind] ?? c.device.kind
  return [
    kind,
    c.device.os,
    c.device.browser,
    c.device.surface === 'desktop-tauri' ? 'App desktop' : 'Navegador',
    c.device.layout === 'mobile' && c.device.kind === 'desktop' ? 'layout de celular' : null,
    c.screen?.viewport,
    c.network ? (c.network.online ? (c.network.type ?? 'online') : 'offline') : null,
    c.screen?.theme,
  ]
    .filter(Boolean)
    .join(' · ')
}
