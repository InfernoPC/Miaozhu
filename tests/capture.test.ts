import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { clipboard } from 'electron'
import { cleanOldScreenshots, defaultScreenshotFolder, saveClipboardImage, takeScreenshot } from '../src/main/capture'
import { SettingsStore } from '../src/main/settings/store'
import type { WindowManager } from '../src/main/windows'
import { Agent, type AgentSettings } from '../src/main/agent/agent'
import { ConversationStore } from '../src/main/agent/conversation-store'
import { MockLLM } from './helpers/mock-llm'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
const shots = () => sb.path('tmp', 'Miaozhu Screenshots')
const mockClipboard = clipboard as unknown as { items: Record<string, string>[] }

beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
  mockClipboard.items = []
})
afterAll(() => sb.cleanup())

/** Records whether the app's windows were out of the way while capturing. */
function fakeWindows() {
  const log: string[] = []
  const windows = {
    hideForCapture: async () => {
      log.push('hide')
      return () => log.push('restore')
    }
  } as unknown as WindowManager
  return { windows, log }
}

describe('screenshots the user takes', () => {
  it('full screen: saves a PNG with the app windows hidden meanwhile', async () => {
    const { windows, log } = fakeWindows()
    const path = await takeScreenshot('full', windows)
    expect(path).toMatch(/截圖 \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.png$/)
    expect(readFileSync(path!, 'utf8')).toBe('png 2880x1800')
    expect(log).toEqual(['hide', 'restore'])
  })

  it('two screenshots in the same second get different names', async () => {
    const { windows } = fakeWindows()
    const a = await takeScreenshot('full', windows)
    const b = await takeScreenshot('full', windows)
    expect(a).not.toBe(b)
    expect(basename(b!)).toMatch(/\(2\)\.png$/)
  })

  it('pastes a PNG from the clipboard as is, and re-encodes other image types', async () => {
    mockClipboard.items = [{ 'text/plain': 'x' }, { 'image/png': 'PNGDATA' }]
    expect(readFileSync((await saveClipboardImage())!, 'utf8')).toBe('PNGDATA')
    mockClipboard.items = [{ 'image/tiff': 'TIFF' }]
    expect(readFileSync((await saveClipboardImage())!, 'utf8')).toBe('png from TIFF')
  })

  it('no image on the clipboard: nothing saved', async () => {
    mockClipboard.items = [{ 'text/plain': 'hello' }]
    expect(await saveClipboardImage()).toBeNull()
    expect(existsSync(shots()) ? readdirSync(shots()) : []).toEqual([])
  })

  it('clears screenshots older than a week at startup', () => {
    mkdirSync(shots(), { recursive: true })
    const old = join(shots(), 'old.png')
    const recent = join(shots(), 'recent.png')
    writeFileSync(old, 'x')
    writeFileSync(recent, 'x')
    const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000
    utimesSync(old, eightDaysAgo, eightDaysAgo)
    cleanOldScreenshots()
    expect(readdirSync(shots())).toEqual(['recent.png'])
  })
})

describe('sending a screenshot', () => {
  it('the model actually gets the image (the folder is not a protected one)', async () => {
    const llm = new MockLLM()
    const baseURL = await llm.start()
    try {
      const settings: AgentSettings = {
        activeProfile: () => ({ id: 'p', name: 'mock', kind: 'openai-compatible', baseURL, model: 'mock-model' }),
        getApiKey: () => 'k',
        allowedFolders: () => [],
        searchCredentials: () => ({ config: { provider: 'none' } }),
        persona: () => undefined,
        places: () => [],
        sensitiveFolders: () => [],
        localProfile: () => null
      }
      const agent = new Agent(settings, () => {}, { hidePet: async () => () => {}, store: new ConversationStore() })
      const path = await takeScreenshot('full', fakeWindows().windows)
      llm.reset([{ text: '看到了' }])
      await agent.send('這是什麼', [path!])
      expect(llm.sentText).not.toContain('受保護')
      expect(JSON.stringify(llm.requests[0].messages)).toContain('data:image')
    } finally {
      await llm.stop()
    }
  })
})

describe('choosing where screenshots go', () => {
  it('saves into the chosen folder, and that folder is never cleaned', async () => {
    const mine = sb.path('Pictures', 'Shots')
    const path = await takeScreenshot('full', fakeWindows().windows, mine)
    expect(path!.startsWith(mine)).toBe(true)
    mockClipboard.items = [{ 'image/png': 'P' }]
    expect((await saveClipboardImage(mine))!.startsWith(mine)).toBe(true)

    const old = join(mine, 'my old screenshot.png')
    writeFileSync(old, 'x')
    const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000
    utimesSync(old, eightDaysAgo, eightDaysAgo)
    cleanOldScreenshots()
    expect(existsSync(old)).toBe(true)
  })

  it('the setting defaults to the temp folder, can be changed and reset', () => {
    const store = new SettingsStore()
    expect(store.view()).toMatchObject({ screenshotFolder: defaultScreenshotFolder(), screenshotFolderIsDefault: true })
    store.setScreenshotFolder(sb.path('Pictures'))
    // A fresh store reads it back from disk.
    expect(new SettingsStore().view()).toMatchObject({ screenshotFolder: sb.path('Pictures'), screenshotFolderIsDefault: false })
    expect(store.setScreenshotFolder(null)).toMatchObject({ screenshotFolder: defaultScreenshotFolder(), screenshotFolderIsDefault: true })
  })
})
