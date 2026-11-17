import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isDesktop } from '~/platform'
import { windowRole } from '~/platform/window-role'
import { startLogging } from '~/platform/logging'
import { App } from '~/ui/App'
import { Dock } from '~/ui/Dock'
import { Note } from '~/ui/Note'
import { Peek } from '~/ui/Peek'
import '~/ui/styles.css'
import '~/ui/design-system.css'

// The desktop window has no title bar of its own, so the interface has to leave
// room for the system's window buttons and offer somewhere to drag from.
if (isDesktop()) document.documentElement.dataset.desktop = 'true'

// The app, the tabs on the edge of the screen, the note that floats out of one
// while the pointer rests on it, and the note somebody clicked and kept, are
// the same bundle in four windows. Which one this is decides what gets mounted,
// and nothing else in the app has to know.
const role = windowRole()
document.documentElement.dataset.window = role
startLogging(role)

// A panel is told its theme by the app's window, which takes a moment. Until
// then it follows the system, so that nothing is ever painted with no theme
// at all.
if (role !== 'main') {
  document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não encontrado')

createRoot(root).render(
  <StrictMode>
    {role === 'dock' ? <Dock /> : role === 'peek' ? <Peek /> : role === 'note' ? <Note /> : <App />}
  </StrictMode>,
)

// The app's window opens hidden (`visible: false` in tauri.conf.json) and shows
// itself once the interface has painted, so it never flashes white. Rust shows
// it anyway after a few seconds, in case this never runs.
if (role === 'main' && isDesktop()) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().show(),
      )
    }),
  )
}
