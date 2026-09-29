import { app } from 'electron'
import type { AgentEvent } from '@shared/types'
import { Agent } from './agent/agent'
import { ConversationStore } from './agent/conversation-store'
import { registerIpc } from './ipc'
import { SettingsStore } from './settings/store'
import { WindowManager } from './windows'

// Only one pet on the desktop: a second launch focuses the first instance instead.
if (!app.requestSingleInstanceLock()) app.quit()

const windows = new WindowManager()

app.on('second-instance', () => windows.openChat())

app.whenReady().then(() => {
  const settings = new SettingsStore()
  const broadcast = (e: AgentEvent) => {
    for (const win of windows.all()) if (!win.isDestroyed()) win.webContents.send('agent:event', e)
  }
  const agent = new Agent(settings, broadcast, { hidePet: () => windows.hidePet(), store: new ConversationStore() })
  registerIpc(agent, settings, windows)

  windows.createPet()
  // First run: nothing configured yet, so guide the user straight to settings.
  if (!settings.activeProfile()) windows.openSettings()

  app.on('activate', () => {
    if (!windows.pet) windows.createPet()
  })
})

// The pet is the app; closing chat/settings windows must not quit it.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
