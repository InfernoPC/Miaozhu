import { app, Notification } from 'electron'
import type { AgentEvent } from '@shared/types'
import { Agent } from './agent/agent'
import { ConversationStore } from './agent/conversation-store'
import { cleanOldScreenshots } from './capture'
import { registerIpc } from './ipc'
import { PluginManager } from './plugins/manager'
import { MarketplaceManager } from './plugins/marketplaces'
import { ReminderService } from './reminders/service'
import { SkinPackManager } from './skins/skin-packs'
import { reminderTools } from './tools/reminders'
import { adoptLoginShellPath } from './util/shell-path'
import { SettingsStore } from './settings/store'
import { UpdateChecker } from './updates/updater'
import { WindowManager } from './windows'

// Only one pet on the desktop: a second launch focuses the first instance instead.
if (!app.requestSingleInstanceLock()) app.quit()

const windows = new WindowManager()

app.on('second-instance', () => windows.openChat())

app.whenReady().then(async () => {
  await adoptLoginShellPath()
  const settings = new SettingsStore()
  const broadcast = (e: AgentEvent) => {
    for (const win of windows.all()) if (!win.isDestroyed()) win.webContents.send('agent:event', e)
  }
  // Settings windows refresh their plugin list when an MCP server starts, fails or stops.
  const notifyPlugins = () => {
    for (const win of windows.all()) if (!win.isDestroyed()) win.webContents.send('plugins:changed')
  }
  const plugins = new PluginManager(settings.vault(), notifyPlugins)
  const marketplaces = new MarketplaceManager({}, notifyPlugins)
  const reminders = new ReminderService({
    deliver: (r) => {
      for (const win of windows.all()) if (!win.isDestroyed()) win.webContents.send('reminder:due', r)
      if (Notification.isSupported()) {
        const n = new Notification({ title: r.late ? '喵助：錯過的提醒' : '喵助提醒', body: r.text, silent: false })
        n.on('click', () => windows.openChat())
        n.show()
      }
    }
  })
  const conversations = new ConversationStore()
  const agent = new Agent(settings, broadcast, {
    hidePet: () => windows.hidePet(),
    store: conversations,
    plugins,
    extraTools: reminderTools(reminders)
  })
  const updates = new UpdateChecker({
    currentVersion: app.getVersion(),
    enabled: app.isPackaged,
    onAvailable: (s) => {
      for (const win of windows.all()) if (!win.isDestroyed()) win.webContents.send('update:available', s)
    }
  })
  registerIpc(agent, settings, windows, plugins, marketplaces, reminders, conversations, new SkinPackManager(), updates)
  reminders.start()
  updates.start()
  cleanOldScreenshots()
  void plugins.start()
  app.on('before-quit', () => {
    reminders.stop()
    updates.stop()
    void plugins.stopAll()
  })

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
