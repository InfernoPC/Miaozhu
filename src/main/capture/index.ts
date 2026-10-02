import { app, clipboard, desktopCapturer, ipcMain, nativeImage, screen, systemPreferences } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptureMode } from '@shared/types'
import { missingPermission } from '../tools/screen'
import { run } from '../util/run'
import type { WindowManager } from '../windows'

const KEEP_DAYS = 7
const PICK_TIMEOUT_MS = 5 * 60_000

/**
 * Not under userData: the agent may never read the app's own folder (it holds the secrets),
 * so a screenshot kept there could be attached but not seen.
 */
const dir = () => join(app.getPath('temp'), 'Miaozhu Screenshots')

/** "截圖 2026-10-02 14.03.05.png", unique within the folder. */
function newPath(): string {
  mkdirSync(dir(), { recursive: true })
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const base = `截圖 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
  let path = join(dir(), `${base}.png`)
  for (let i = 2; existsSync(path); i++) path = join(dir(), `${base} (${i}).png`)
  return path
}

/** Screenshots are only needed until they've been sent; old ones are cleared at startup. */
export function cleanOldScreenshots(): void {
  if (!existsSync(dir())) return
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  for (const name of readdirSync(dir())) {
    const file = join(dir(), name)
    try {
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true })
    } catch {
      // Gone already or in use: try again next time.
    }
  }
}

function checkPermission(): void {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') missingPermission()
}

/** The whole display under the mouse, at full resolution. */
async function grabDisplay(display: Electron.Display): Promise<Electron.NativeImage> {
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  // macOS returns an empty image (not an error) without permission.
  if (!source || source.thumbnail.isEmpty()) missingPermission()
  return source.thumbnail
}

/** macOS's own picker: drag a region, or press Space and click a window. Esc cancels. */
async function pickMac(path: string): Promise<boolean> {
  // -i interactive, -o no window shadow, -x no sound. Exits 0 with no file when cancelled.
  await run('screencapture', ['-i', '-o', '-x', path], dir(), PICK_TIMEOUT_MS).catch(() => {})
  return existsSync(path) && statSync(path).size > 0
}

/** Our overlay: shows a still of the screen; the user drags a region. Esc cancels. */
async function pickOverlay(windows: WindowManager, path: string): Promise<boolean> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const still = await grabDisplay(display)
  const win = windows.openSnip(display.bounds)
  try {
    const rect = await new Promise<Electron.Rectangle | null>((resolve) => {
      const finish = (r: Electron.Rectangle | null) => {
        clearTimeout(timer)
        ipcMain.removeListener('snip:done', onDone)
        resolve(r)
      }
      const onDone = (e: Electron.IpcMainEvent, r: Electron.Rectangle | null) => {
        if (e.sender === win.webContents) finish(r)
      }
      const timer = setTimeout(() => finish(null), PICK_TIMEOUT_MS)
      ipcMain.on('snip:done', onDone)
      win.on('closed', () => finish(null))
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('snip:image', still.toDataURL())
        win.show()
        win.focus()
      })
    })
    if (!rect || rect.width < 4 || rect.height < 4) return false
    const k = still.getSize().width / display.bounds.width
    const crop = still.crop({ x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) })
    writeFileSync(path, crop.toPNG())
    return true
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * Takes a screenshot the user asked for and saves it as a PNG for attaching. The app's own
 * windows step aside meanwhile. Returns null when the user cancels.
 */
export async function takeScreenshot(mode: CaptureMode, windows: WindowManager): Promise<string | null> {
  checkPermission()
  const path = newPath()
  const restore = await windows.hideForCapture()
  try {
    if (mode === 'full') {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      writeFileSync(path, (await grabDisplay(display)).toPNG())
      return path
    }
    const ok = process.platform === 'darwin' && !process.env.MIAOZHU_SNIP_OVERLAY ? await pickMac(path) : await pickOverlay(windows, path)
    return ok ? path : null
  } finally {
    restore()
  }
}

/** An image on the clipboard (e.g. from ⌃⇧⌘4 or Win+Shift+S), saved for attaching. */
export async function saveClipboardImage(): Promise<string | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (!type) continue
    const blob = (await item.getType(type)) as Blob
    const bytes = Buffer.from(await blob.arrayBuffer())
    // Re-encode anything that isn't PNG (TIFF, JPEG…) so the model gets a format it reads.
    const png = type === 'image/png' ? bytes : nativeImage.createFromBuffer(bytes).toPNG()
    if (!png.length) continue
    const path = newPath()
    writeFileSync(path, png)
    return path
  }
  return null
}
