import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import {
  PET_SKINS,
  type HitRect,
  type PermissionDecision,
  type SaveProfileInput,
  type SaveSearchInput,
  type TestResult
} from '@shared/types'
import type { Agent } from './agent/agent'
import { cancelOpenRouterConnect, connectOpenRouter } from './auth/openrouter'
import { createProvider, describeError } from './providers'
import { auditLogPath } from './permissions/guard'
import type { SettingsStore } from './settings/store'
import { searchWeb } from './tools/web'
import type { WindowManager } from './windows'

const TEST_TIMEOUT_MS = 20_000

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

export function registerIpc(agent: Agent, settings: SettingsStore, windows: WindowManager): void {
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
  ipcMain.handle('settings:removeAllowedFolder', (_e, path: string) =>
    settings.setAllowedFolders(settings.allowedFolders().filter((f) => f !== path))
  )
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
        submenu: PET_SKINS.map((s) => ({
          label: s.label,
          type: 'radio' as const,
          checked: s.id === view.petSkin,
          click: () => {
            settings.setPetSkin(s.id)
            windows.pet?.webContents.send('pet:skin', s.id)
          }
        }))
      },
      { label: '清除對話', click: () => agent.clear() },
      { type: 'separator' },
      { label: '設定…', click: () => windows.openSettings() },
      { type: 'separator' },
      { label: '結束', click: () => app.quit() }
    ]).popup({ window: BrowserWindow.fromWebContents(e.sender) ?? undefined })
  })

  ipcMain.on('windows:openChat', () => windows.openChat())
  ipcMain.on('windows:openSettings', () => windows.openSettings())
}
