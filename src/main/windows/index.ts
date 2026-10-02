import { BrowserWindow, powerMonitor, screen, shell } from 'electron'
import { join } from 'node:path'
import type { HitRect } from '@shared/types'

type Route = 'pet' | 'chat' | 'settings' | 'snip' | 'gallery'

// Tall enough for a reply balloon plus the input box above the cat; the empty part is transparent and click-through.
const PET_SIZE = { width: 340, height: 520 }
const HIT_TEST_INTERVAL_MS = 50
const REASSERT_TOP_MS = 15_000

function load(win: BrowserWindow, route: Route): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

function baseWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false
  }
}

/** Links clicked inside the app open in the system browser, never inside Electron. */
function externalLinks(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A link without target=_blank would otherwise replace the app page itself.
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) return
    ev.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

/**
 * Windows sometimes drops a window's topmost flag — after the screen locks or the PC sleeps,
 * or when another always-on-top app takes over — while Electron still believes it is set, so
 * the cat ends up behind other windows. Put it back now and then; this only changes the
 * stacking order and never takes keyboard focus. Returns a function that stops it.
 */
function keepOnTop(win: BrowserWindow): () => void {
  if (process.platform !== 'win32') return () => {}
  const reassert = () => {
    if (win.isDestroyed() || !win.isVisible()) return
    win.setAlwaysOnTop(false)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.moveTop()
  }
  const timer = setInterval(reassert, REASSERT_TOP_MS)
  powerMonitor.on('resume', reassert)
  powerMonitor.on('unlock-screen', reassert)
  screen.on('display-metrics-changed', reassert)
  return () => {
    clearInterval(timer)
    powerMonitor.removeListener('resume', reassert)
    powerMonitor.removeListener('unlock-screen', reassert)
    screen.removeListener('display-metrics-changed', reassert)
  }
}

export class WindowManager {
  pet: BrowserWindow | null = null
  private chat: BrowserWindow | null = null
  private settings: BrowserWindow | null = null
  private gallery: BrowserWindow | null = null
  private dragOffset: { x: number; y: number } | null = null
  private hitRects: HitRect[] = []
  private ignoring = true
  private hitTimer: NodeJS.Timeout | null = null

  createPet(): BrowserWindow {
    const { workArea } = screen.getPrimaryDisplay()
    const win = new BrowserWindow({
      ...PET_SIZE,
      x: workArea.x + workArea.width - PET_SIZE.width - 24,
      y: workArea.y + workArea.height - PET_SIZE.height,
      transparent: true,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: baseWebPreferences()
    })
    // Stay above full-screen apps on macOS as well.
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    const stopKeepingOnTop = keepOnTop(win)
    // Transparent areas let clicks through. Hit-testing polls the cursor from main instead of
    // relying on forwarded mousemove events, because those don't arrive during an OS file drag —
    // and dropping files onto the cat is a core interaction.
    win.setIgnoreMouseEvents(true, { forward: true })
    this.ignoring = true
    this.hitTimer = setInterval(() => this.hitTest(), HIT_TEST_INTERVAL_MS)
    externalLinks(win)
    load(win, 'pet')
    win.on('closed', () => {
      stopKeepingOnTop()
      if (this.hitTimer) clearInterval(this.hitTimer)
      this.pet = null
    })
    this.pet = win
    return win
  }

  setPetHitRects(rects: HitRect[]): void {
    this.hitRects = rects
  }

  private hitTest(): void {
    const pet = this.pet
    if (!pet || pet.isDestroyed() || !pet.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const b = pet.getBounds()
    const x = cursor.x - b.x
    const y = cursor.y - b.y
    const over = this.dragOffset !== null || this.hitRects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    if (over === !this.ignoring) return
    this.ignoring = !over
    pet.setIgnoreMouseEvents(this.ignoring, { forward: true })
  }

  /** Makes the pet invisible (e.g. for a screenshot); returns a function that restores it. */
  async hidePet(): Promise<() => void> {
    const pet = this.pet
    if (!pet || pet.isDestroyed()) return () => {}
    pet.setOpacity(0)
    // Give the compositor a frame or two so the capture doesn't catch a half-faded cat.
    await new Promise((r) => setTimeout(r, 120))
    return () => {
      if (!pet.isDestroyed()) pet.setOpacity(1)
    }
  }

  /**
   * Gets every app window out of the way for a screenshot the user takes; returns a function
   * that brings them back as they were.
   */
  async hideForCapture(): Promise<() => void> {
    const showPet = await this.hidePet()
    const hidden = [this.chat, this.settings].filter((w): w is BrowserWindow => !!w && !w.isDestroyed() && w.isVisible())
    for (const w of hidden) w.hide()
    if (hidden.length) await new Promise((r) => setTimeout(r, 200))
    return () => {
      showPet()
      for (const w of hidden) if (!w.isDestroyed()) w.show()
    }
  }

  /** Full-screen overlay for picking a region (Windows; macOS uses its own picker). */
  openSnip(bounds: Electron.Rectangle): BrowserWindow {
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      webPreferences: baseWebPreferences()
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    load(win, 'snip')
    return win
  }

  openChat(): void {
    if (this.chat) return this.focus(this.chat)
    this.chat = new BrowserWindow({
      width: 460,
      height: 640,
      minWidth: 360,
      minHeight: 400,
      title: '喵助',
      show: false,
      webPreferences: baseWebPreferences()
    })
    this.chat.once('ready-to-show', () => this.chat?.show())
    this.chat.on('closed', () => (this.chat = null))
    externalLinks(this.chat)
    load(this.chat, 'chat')
  }

  openGallery(): void {
    if (this.gallery) return this.focus(this.gallery)
    this.gallery = new BrowserWindow({
      width: 900,
      height: 680,
      minWidth: 520,
      minHeight: 420,
      title: '梗圖庫',
      show: false,
      webPreferences: baseWebPreferences()
    })
    this.gallery.once('ready-to-show', () => this.gallery?.show())
    this.gallery.on('closed', () => (this.gallery = null))
    externalLinks(this.gallery)
    load(this.gallery, 'gallery')
  }

  openSettings(): void {
    if (this.settings) return this.focus(this.settings)
    this.settings = new BrowserWindow({
      width: 640,
      height: 620,
      minWidth: 520,
      minHeight: 480,
      title: '設定',
      show: false,
      webPreferences: baseWebPreferences()
    })
    this.settings.once('ready-to-show', () => this.settings?.show())
    this.settings.on('closed', () => (this.settings = null))
    externalLinks(this.settings)
    load(this.settings, 'settings')
  }

  /** Cursor position is read in main so dragging works across displays with different scale factors. */
  petDragStart(): void {
    if (!this.pet) return
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = this.pet.getPosition()
    this.dragOffset = { x: cursor.x - x, y: cursor.y - y }
  }

  petDragEnd(): void {
    this.dragOffset = null
  }

  petDragMove(): void {
    if (!this.pet || !this.dragOffset) return
    const cursor = screen.getCursorScreenPoint()
    this.pet.setBounds({ x: cursor.x - this.dragOffset.x, y: cursor.y - this.dragOffset.y, ...PET_SIZE })
  }

  all(): BrowserWindow[] {
    return BrowserWindow.getAllWindows()
  }

  private focus(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}
