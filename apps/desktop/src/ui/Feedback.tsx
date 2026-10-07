/**
 * Feedback do app: o painel do feedback-kit (`github.com/megomes/feedback-kit`), o mesmo
 * de todos os apps do Matheus.
 *
 * O painel em si, a API e as regras da fila vivem no kit e se atualizam lá. Aqui fica só
 * o que é deste app: abrir por cima do editor sem perder o lugar, mapear os tokens do
 * tema nos `--fb-*` (feedback.css), dizer a versão e a etapa, e mandar os links de
 * commit para o navegador do sistema.
 *
 * O script vem do Worker do kit a cada abertura, e uma cópia fica guardada neste
 * aparelho: sem conexão, o painel abre com a última versão, e as notas escritas offline
 * sobem quando a conexão volta.
 */

import { useEffect, useRef, useState } from 'react'
import { STAGE } from '~/app/client-context'
import { isDesktop } from '~/platform'
import './feedback.css'

// The feedback-kit Worker, set at build time (see apps/desktop/.env.example).
const KIT: string = ((import.meta.env.VITE_FEEDBACK_KIT_URL as string | undefined) ?? '').replace(
  /\/+$/,
  '',
)
const APP = 'markdown-viewer'
const CACHE_KEY = 'markdown-viewer.feedback-kit.widget'
/** Where the code lived before the kit; moved once to the kit's own key. */
const OLD_CODE_KEY = 'markdown-viewer.feedback-code'

type PanelElement = HTMLElement & {
  appContext: () => Record<string, unknown>
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'feedback-panel': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        app: string
        api?: string
        screen?: string
        closable?: boolean
      }
    }
  }
}

function adoptOldCode() {
  try {
    const old = localStorage.getItem(OLD_CODE_KEY)
    const key = `feedback-kit.${APP}.code`
    if (old && !localStorage.getItem(key)) localStorage.setItem(key, old)
  } catch {
    // storage blocked: the panel asks for the code
  }
}

let loading: Promise<void> | null = null

/** The widget from the kit, or the copy kept from the last time it loaded. */
function loadWidget(): Promise<void> {
  if (customElements.get('feedback-panel')) return Promise.resolve()
  loading ??= (async () => {
    let source: string | null = null
    try {
      const res = await fetch(`${KIT}/v1/widget.js`, { cache: 'no-cache' })
      if (res.ok) source = await res.text()
    } catch {
      // offline: the kept copy below
    }
    try {
      if (source) localStorage.setItem(CACHE_KEY, source)
      else source = localStorage.getItem(CACHE_KEY)
    } catch {
      // storage blocked
    }
    if (!source) throw new Error('feedback-kit unavailable')
    // From a blob the module cannot tell where it came from, so the panel gets the
    // API in its `api` attribute.
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    try {
      await import(/* @vite-ignore */ url)
    } finally {
      URL.revokeObjectURL(url)
    }
  })().catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}

interface Props {
  /** The kind of view that was open, and its file's extension: never a path. */
  screen: string
  onClose: () => void
}

export function Feedback({ screen, onClose }: Props) {
  const panel = useRef<PanelElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(() =>
    customElements.get('feedback-panel') ? 'ready' : 'loading',
  )

  useEffect(() => {
    adoptOldCode()
    loadWidget().then(
      () => setState('ready'),
      () => setState('unavailable'),
    )
  }, [])

  useEffect(() => {
    const el = panel.current
    if (!el) return
    el.appContext = () => ({ version: __APP_VERSION__, stage: STAGE })
    const onLink = (event: Event) => {
      if (!isDesktop()) return
      // The desktop webview opens no new windows: the link goes to the system browser.
      event.preventDefault()
      const { url } = (event as CustomEvent<{ url: string }>).detail
      void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url))
    }
    el.addEventListener('feedback-close', onClose)
    el.addEventListener('feedback-link', onLink)
    return () => {
      el.removeEventListener('feedback-close', onClose)
      el.removeEventListener('feedback-link', onLink)
    }
  }, [state, onClose])

  // Escape still closes while the panel is loading or could not load.
  useEffect(() => {
    if (state === 'ready') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state, onClose])

  return (
    <div className="fb-layer">
      {state === 'ready' ? (
        <feedback-panel ref={panel} app={APP} api={KIT} screen={screen} lang="pt" closable />
      ) : (
        <p className="fb-wait">
          {state === 'loading'
            ? 'Abrindo o feedback…'
            : 'O feedback precisa de conexão na primeira vez que abre neste aparelho.'}
        </p>
      )}
    </div>
  )
}
