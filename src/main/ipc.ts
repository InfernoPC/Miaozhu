import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  type HitRect,
  type PermissionDecision,
  type PluginSource,
  type SavedPlace,
  type SaveProfileInput,
  type SaveSearchInput,
  type AttachmentView,
  type CaptureMode,
  type TestResult
} from '@shared/types'
import type { Agent } from './agent/agent'
import { cancelOpenRouterConnect, connectOpenRouter } from './auth/openrouter'
import { createProvider, describeError } from './providers'
import { auditLogPath } from './permissions/guard'
import type { PluginManager } from './plugins/manager'
import { formToJson, parseMcpImport } from './plugins/mcp-import'
import type { MarketplaceManager } from './plugins/marketplaces'
import type { ReminderService } from './reminders/service'
import type { ConversationStore } from './agent/conversation-store'
import type { SkinPackManager } from './skins/skin-packs'
import type { SettingsStore } from './settings/store'
import { defaultScreenshotFolder, saveClipboardImage, takeScreenshot } from './capture'
import { realPath } from './tools/paths'
import { launchInstaller, type UpdateChecker } from './updates/updater'
import { searchWeb } from './tools/web'
import type { WindowManager } from './windows'

const TEST_TIMEOUT_MS = 20_000

/** Minutes until tomorrow 9:00, for "until tomorrow morning". */
function minutesUntilMorning(): number {
  const now = new Date()
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
  return Math.ceil((morning.getTime() - now.getTime()) / 60_000)
}

function dndMenu(reminders: ReminderService): Electron.MenuItemConstructorOptions {
  const dnd = reminders.dnd()
  const until = dnd.until && new Date(dnd.until) > new Date() ? new Date(dnd.until) : null
  const label = until ? `勿擾中（到 ${until.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}）` : dnd.active ? '勿擾中（安靜時段）' : '勿擾模式'
  return {
    label,
    submenu: [
      { label: '1 小時', click: () => reminders.setDnd(60) },
      { label: '3 小時', click: () => reminders.setDnd(180) },
      { label: '直到明天早上 9 點', click: () => reminders.setDnd(minutesUntilMorning()) },
      { type: 'separator' },
      { label: '關閉勿擾', enabled: !!until, click: () => reminders.setDnd(null) }
    ]
  }
}

async function testConnection(settings: SettingsStore, input: SaveProfileInput): Promise<TestResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    const provider = createProvider(input.profile, settings.resolveApiKey(input))
    const stream = provider.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the single word: OK' }] }],
      signal: controller.signal
    })
    let model = input.profile.model
    for await (const ev of stream) {
      if (ev.type === 'model') model = ev.model
      else if (ev.type === 'text' && ev.text.trim()) return { ok: true, message: `連線成功（${model}）回應：「${ev.text.trim().slice(0, 20)}…」` }
    }
    return { ok: false, message: '連線成功，但模型沒有回傳任何文字' }
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, message: '連線逾時（20 秒），請檢查 Base URL 或網路 / VPN' }
    return { ok: false, message: describeError(err) }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

export function registerIpc(
  agent: Agent,
  settings: SettingsStore,
  windows: WindowManager,
  plugins: PluginManager,
  marketplaces: MarketplaceManager,
  reminders: ReminderService,
  conversations: ConversationStore,
  skins: SkinPackManager,
  updates: UpdateChecker
): void {
  const installUpdate = () => {
    if (!app.isPackaged) throw new Error('開發版不能自動更新，請用 git pull')
    launchInstaller(process.platform, app.getPath('exe'))
    // Give the child a moment to detach before this process goes away.
    setTimeout(() => app.quit(), 500)
  }
  /** The chosen folder, unless it has since become off-limits to the agent. */
  const screenshotFolder = async () => {
    const chosen = settings.screenshotFolder()
    return agent.guard.isBlocked(await realPath(chosen)) ? defaultScreenshotFolder() : chosen
  }
  const capture = async (mode: CaptureMode): Promise<AttachmentView | null> => {
    const path = await takeScreenshot(mode, windows, await screenshotFolder())
    return path ? (await agent.describeAttachments([path]))[0] : null
  }
  /** From the pet's menu: the result goes to the pet's input box. */
  const captureForPet = async (mode: CaptureMode) => {
    try {
      const attachment = await capture(mode)
      if (!attachment) return
      // Keyboard focus for the input box: after the picker, focus is back in the other app.
      windows.pet?.focus()
      windows.pet?.webContents.send('capture:attached', { attachment })
    } catch (err) {
      windows.pet?.webContents.send('capture:attached', { error: (err as Error).message })
    }
  }
  const selectSkin = (id: string) => {
    settings.setPetSkin(id)
    windows.pet?.webContents.send('pet:skin', id)
  }
  ipcMain.handle('skins:list', () => skins.list())
  ipcMain.handle('skins:load', (_e, id: string) => skins.load(id))
  ipcMain.handle('skins:install', async (e, from: 'folder' | 'zip') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions =
      from === 'folder'
        ? { title: '選擇造型資料夾（裡面要有 skin.json）', properties: ['openDirectory'] }
        : { title: '選擇造型 zip 檔', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return null
    selectSkin(await skins.install({ kind: from, path: res.filePaths[0] }))
    return skins.list()
  })
  ipcMain.handle('skins:remove', (_e, id: string) => {
    skins.remove(id)
    if (settings.view().petSkin === id) selectSkin('desk')
    return skins.list()
  })
  ipcMain.handle('skins:select', (_e, id: string) => selectSkin(id))

  ipcMain.handle('conversations:list', () => conversations.list())
  ipcMain.handle('conversations:current', () => agent.currentConversation())
  ipcMain.handle('conversations:open', (_e, id: string) => agent.openConversation(id))
  ipcMain.handle('conversations:create', () => agent.newConversation())
  ipcMain.handle('conversations:rename', (_e, id: string, title: string) => (conversations.rename(id, title), conversations.list()))
  ipcMain.handle('conversations:remove', (_e, id: string) => (agent.deleteConversation(id), conversations.list()))

  ipcMain.handle('reminders:list', () => reminders.list())
  ipcMain.handle('reminders:cancel', (_e, id: string) => (reminders.cancel(id), reminders.list()))
  ipcMain.handle('reminders:dismiss', (_e, id: string) => reminders.dismiss(id))
  ipcMain.handle('reminders:snooze', (_e, id: string, minutes: number) => reminders.snooze(id, minutes))
  ipcMain.handle('reminders:dnd', () => reminders.dnd())
  ipcMain.handle('reminders:setDnd', (_e, minutes: number | null) => reminders.setDnd(minutes))
  ipcMain.handle('reminders:setQuietHours', (_e, start: string | null, end: string | null) => reminders.setQuietHours(start, end))

  ipcMain.handle('plugins:list', () => plugins.list())
  ipcMain.handle('plugins:inspect', async (e, source: PluginSource) => {
    if (source.kind === 'git') return plugins.inspect(source)
    if (source.kind === 'mcp') return plugins.inspect({ kind: 'mcp', import: parseMcpImport(source.text, source.name) })
    if (source.kind === 'mcp-form') return plugins.inspect({ kind: 'mcp', import: parseMcpImport(formToJson(source.form)) })
    if (source.kind === 'marketplace') {
      const { entry, fetch } = await marketplaces.resolve(source.marketplace, source.entry)
      const sha = entry.source.kind === 'git' ? entry.source.sha : undefined
      return plugins.inspect({ kind: 'entry', fetch, origin: { marketplace: source.marketplace, entry: entry.name, version: entry.version, sha } })
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions =
      source.kind === 'folder'
        ? { title: '選擇外掛資料夾', properties: ['openDirectory'] }
        : { title: '選擇外掛 zip 檔', properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return null
    return plugins.inspect({ kind: source.kind, path: res.filePaths[0] })
  })
  ipcMain.handle('plugins:install', (_e, stagingId: string) => plugins.install(stagingId))
  ipcMain.handle('plugins:cancelInstall', (_e, stagingId: string) => plugins.cancelInstall(stagingId))
  ipcMain.handle('plugins:setEnabled', (_e, id: string, enabled: boolean) => plugins.setEnabled(id, enabled))
  ipcMain.handle('plugins:remove', (_e, id: string) => plugins.remove(id))
  ipcMain.handle('marketplaces:list', async () => {
    // First look at the list: fetch catalogs that haven't been loaded yet, in the background.
    void marketplaces.loadMissing()
    return marketplaces.list(plugins.list())
  })
  ipcMain.handle('marketplaces:add', async (_e, input: string) => {
    await marketplaces.add(input)
    return marketplaces.list(plugins.list())
  })
  ipcMain.handle('marketplaces:remove', async (_e, name: string, uninstallPlugins: boolean) => {
    if (uninstallPlugins) {
      for (const p of plugins.list().filter((x) => x.origin?.marketplace === name)) await plugins.remove(p.id)
    }
    marketplaces.remove(name)
    return marketplaces.list(plugins.list())
  })
  ipcMain.handle('marketplaces:refresh', async (_e, name: string) => {
    await marketplaces.refresh(name)
    return marketplaces.list(plugins.list())
  })
  ipcMain.handle('plugins:setSecret', (_e, id: string, name: string, value: string) => plugins.setSecret(id, name, value))

  ipcMain.handle('agent:send', (_e, text: string, attachments?: string[]) => agent.send(text, attachments))
  ipcMain.handle('agent:respondPermission', (_e, id: string, decision: PermissionDecision) => agent.respondPermission(id, decision))
  ipcMain.handle('agent:pendingPermissions', () => agent.pendingPermissions())
  ipcMain.handle('agent:describeAttachments', (_e, paths: string[]) => agent.describeAttachments(paths))
  ipcMain.handle('agent:cancel', () => agent.cancel())
  ipcMain.handle('agent:history', () => agent.getHistory())
  ipcMain.handle('agent:clear', () => agent.clear())

  ipcMain.handle('settings:get', () => settings.view())
  ipcMain.handle('settings:saveProfile', (_e, input: SaveProfileInput) => settings.saveProfile(input))
  ipcMain.handle('settings:deleteProfile', (_e, id: string) => settings.deleteProfile(id))
  ipcMain.handle('settings:setActive', (_e, id: string) => settings.setActive(id))
  ipcMain.handle('settings:test', (_e, input: SaveProfileInput) => testConnection(settings, input))
  ipcMain.handle('settings:listModels', async (_e, input: SaveProfileInput) => {
    try {
      return await createProvider(input.profile, settings.resolveApiKey(input)).listModels()
    } catch (err) {
      throw new Error(describeError(err))
    }
  })

  ipcMain.handle('settings:connectOpenRouter', async (_e, input: SaveProfileInput) => {
    const apiKey = await connectOpenRouter()
    windows.openSettings() // bring the app back in front of the browser
    return settings.saveProfile({ profile: input.profile, apiKey })
  })
  ipcMain.handle('settings:cancelConnect', () => cancelOpenRouterConnect())

  ipcMain.handle('settings:addAllowedFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { title: '選擇允許喵助讀取的資料夾', properties: ['openDirectory', 'createDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return settings.view()
    const chosen = res.filePaths[0]
    if (agent.guard.isBlocked(chosen)) throw new Error('這個資料夾屬於受保護的位置，不能加入')
    return settings.setAllowedFolders([...settings.allowedFolders(), chosen])
  })
  ipcMain.handle('settings:chooseScreenshotFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { title: '選擇截圖存放位置', defaultPath: settings.screenshotFolder(), properties: ['openDirectory', 'createDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return settings.view()
    const chosen = res.filePaths[0]
    // Otherwise screenshots would be saved where the agent can never read them.
    if (agent.guard.isBlocked(await realPath(chosen))) throw new Error('這個資料夾屬於受保護的位置，喵助讀不到裡面的截圖，請換一個')
    return settings.setScreenshotFolder(chosen)
  })
  ipcMain.handle('settings:resetScreenshotFolder', () => settings.setScreenshotFolder(null))
  ipcMain.handle('settings:openScreenshotFolder', async () => {
    const folder = await screenshotFolder()
    mkdirSync(folder, { recursive: true })
    await shell.openPath(folder)
  })
  ipcMain.handle('settings:addSensitiveFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = { title: '選擇只能交給本機模型的資料夾', properties: ['openDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return settings.view()
    return settings.setSensitiveFolders([...settings.sensitiveFolders(), res.filePaths[0]])
  })
  ipcMain.handle('settings:removeSensitiveFolder', (_e, path: string) =>
    settings.setSensitiveFolders(settings.sensitiveFolders().filter((f) => f !== path))
  )
  ipcMain.handle('settings:setLocalProfile', (_e, id: string | null) => settings.setLocalProfile(id))
  ipcMain.handle('settings:removeAllowedFolder', (_e, path: string) =>
    settings.setAllowedFolders(settings.allowedFolders().filter((f) => f !== path))
  )
  ipcMain.handle('settings:savePersona', (_e, text: string) => settings.savePersona(text))
  ipcMain.handle('settings:savePlaces', (_e, places: SavedPlace[]) => settings.savePlaces(places))
  ipcMain.handle('settings:saveSearch', (_e, input: SaveSearchInput) => settings.saveSearch(input))
  ipcMain.handle('settings:testSearch', async (_e, input: SaveSearchInput): Promise<TestResult> => {
    try {
      const hits = await searchWeb('台灣 天氣', 3, { config: input.config, apiKey: settings.resolveSearchKey(input) }, AbortSignal.timeout(20_000))
      return { ok: true, message: hits.length ? `搜尋成功，第一筆：「${hits[0].title}」` : '連線成功，但沒有搜尋結果' }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })
  ipcMain.handle('settings:openAuditLog', async () => {
    const path = auditLogPath()
    if (!existsSync(path)) writeFileSync(path, '', { mode: 0o600 })
    shell.showItemInFolder(path)
  })

  ipcMain.on('pet:setHitRects', (_e, rects: HitRect[]) => windows.setPetHitRects(rects))
  ipcMain.on('pet:dragStart', () => windows.petDragStart())
  ipcMain.on('pet:dragMove', () => windows.petDragMove())
  ipcMain.on('pet:dragEnd', () => windows.petDragEnd())
  ipcMain.on('pet:showMenu', (e) => {
    const view = settings.view()
    Menu.buildFromTemplate([
      { label: '開啟對話視窗', click: () => windows.openChat() },
      {
        label: '切換模型連線',
        enabled: view.profiles.length > 0,
        submenu: view.profiles.map((p) => ({
          label: `${p.name}（${p.model}）`,
          type: 'radio' as const,
          checked: p.id === view.activeProfileId,
          click: () => settings.setActive(p.id)
        }))
      },
      {
        label: '切換造型',
        submenu: [
          ...skins.list().map((s) => ({
            label: s.name,
            type: 'radio' as const,
            checked: s.id === view.petSkin,
            click: () => selectSkin(s.id)
          })),
          { type: 'separator' as const },
          { label: '管理造型…', click: () => windows.openSettings() }
        ]
      },
      {
        label: '截圖問喵助',
        submenu: [
          { label: process.platform === 'darwin' ? '框選範圍或視窗' : '框選範圍', click: () => void captureForPet('region') },
          { label: '整個螢幕', click: () => void captureForPet('full') }
        ]
      },
      dndMenu(reminders),
      { label: '新對話', click: () => agent.newConversation() },
      ...(updates.get().available ? [{ label: `更新到 ${updates.get().latest}…`, click: () => installUpdate() }] : []),
      { type: 'separator' },
      { label: '設定…', click: () => windows.openSettings() },
      { type: 'separator' },
      { label: '結束', click: () => app.quit() }
    ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined })
  })

  ipcMain.handle('capture:take', (_e, mode: CaptureMode) => capture(mode === 'full' ? 'full' : 'region'))
  ipcMain.handle('capture:choose', (e) => {
    return new Promise<AttachmentView | null>((resolve, reject) => {
      let picked = false
      const take = (mode: CaptureMode) => {
        picked = true
        capture(mode).then(resolve, reject)
      }
      Menu.buildFromTemplate([
        { label: process.platform === 'darwin' ? '框選範圍或視窗' : '框選範圍', click: () => take('region') },
        { label: '整個螢幕', click: () => take('full') }
      ]).popup({
        window: BrowserWindow.fromWebContents(e.sender) ?? undefined,
        // Runs after a click handler too; only an empty close means "cancelled".
        callback: () => setTimeout(() => !picked && resolve(null), 0)
      })
    })
  })
  ipcMain.handle('capture:paste', async () => {
    const path = await saveClipboardImage(await screenshotFolder())
    return path ? (await agent.describeAttachments([path]))[0] : null
  })

  ipcMain.handle('updates:status', () => updates.get())
  ipcMain.handle('updates:check', () => updates.check())
  ipcMain.handle('updates:install', () => installUpdate())
  ipcMain.on('updates:openReleasePage', () => {
    const url = updates.get().url ?? 'https://github.com/InfernoPC/Miaozhu/releases/latest'
    void shell.openExternal(url)
  })

  ipcMain.on('windows:openChat', () => windows.openChat())
  ipcMain.on('windows:openSettings', () => windows.openSettings())
}
