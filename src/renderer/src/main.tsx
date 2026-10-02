import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Chat } from './chat/Chat'
import { Pet } from './pet/Pet'
import { Settings } from './settings/Settings'
import { Snip } from './snip/Snip'
import '@fontsource/huninn/chinese-traditional-400.css'
import '@fontsource/huninn/latin-400.css'
import './styles.css'

// Each BrowserWindow loads the same bundle and picks its view from the URL hash.
const route = window.location.hash.slice(1)
document.documentElement.dataset.route = route

const views: Record<string, React.ComponentType> = { pet: Pet, chat: Chat, settings: Settings, snip: Snip }
const View = views[route] ?? Chat

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <View />
  </StrictMode>
)
