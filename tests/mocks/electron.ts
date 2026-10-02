/**
 * Minimal stand-in for the Electron APIs the main-process code touches, so it can run under
 * plain Node in Vitest. Paths are set per test via `app.setPath` (see helpers/sandbox.ts).
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

const paths: Record<string, string> = {}

export const app = {
  getPath(name: string): string {
    const p = paths[name]
    if (!p) throw new Error(`test: app.getPath('${name}') not set`)
    return p
  },
  setPath(name: string, value: string): void {
    paths[name] = value
  },
  getName: () => 'desktop-agent',
  isPackaged: false
}

/** Reversible "encryption" so tests can check that stored keys round-trip. */
export const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`enc:${s}`),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
}

export const shell = {
  opened: [] as string[],
  async openExternal(url: string): Promise<void> {
    shell.opened.push(url)
  },
  /** Moves into <sandbox>/.Trash so tests can assert the file went to the trash, not away. */
  async trashItem(p: string): Promise<void> {
    const trash = join(app.getPath('home'), '.Trash')
    mkdirSync(trash, { recursive: true })
    renameSync(p, join(trash, basename(p)))
  },
  showItemInFolder(): void {}
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

function fakeImage(width: number, height: number, empty = false) {
  const img = {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }: { width: number; height: number }) => fakeImage(w, h),
    toJPEG: () => Buffer.from(`jpeg ${width}x${height}`),
    toPNG: () => Buffer.from(`png ${width}x${height}`),
    crop: ({ width: w, height: h }: { width: number; height: number }) => fakeImage(w, h)
  }
  return img
}

export const nativeImage = {
  createFromBuffer: (b: Buffer) => ({ toPNG: () => Buffer.from(`png from ${b.toString()}`) }),
  createFromPath: (p: string) => (existsSync(p) && IMAGE_EXTS.has(extname(p).toLowerCase()) ? fakeImage(2400, 1600) : fakeImage(0, 0, true))
}

export const systemPreferences = { getMediaAccessStatus: () => 'granted' }
export const screen = {
  getCursorScreenPoint: () => ({ x: 10, y: 10 }),
  getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, size: { width: 1440, height: 900 }, scaleFactor: 2 }),
  getAllDisplays: () => [{ id: 1, size: { width: 1440, height: 900 }, scaleFactor: 2 }],
  getPrimaryDisplay: () => ({ id: 1, size: { width: 1440, height: 900 }, scaleFactor: 2 })
}
export const desktopCapturer = {
  getSources: async () => [{ display_id: '1', thumbnail: fakeImage(2880, 1800) }]
}

export class ClipboardItem {
  constructor(readonly data: Record<string, unknown>) {}
  get types() {
    return Object.keys(this.data)
  }
}

/** Clipboard items for a test to set: [{ mime: content }]; `written` holds what the app wrote. */
export const clipboard = {
  items: [] as Record<string, string>[],
  written: [] as ClipboardItem[],
  async write(items: ClipboardItem[]) {
    clipboard.written = items
  },
  async read() {
    return clipboard.items.map((item) => ({
      types: Object.keys(item),
      getType: async (t: string) => new Blob([item[t]])
    }))
  }
}

export const ipcMain = { on() {}, removeListener() {}, handle() {} }
