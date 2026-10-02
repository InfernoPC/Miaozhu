import { app, desktopCapturer, screen, shell, systemPreferences } from 'electron'
import { imageToDataUrl } from './fs'
import { ToolError, type ToolDef } from './types'

const SCREEN_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/**
 * macOS grants screen recording to the "responsible" app. Packaged, that's this app; in
 * development it's the terminal that launched `npm run dev` (iTerm, Terminal, VS Code…).
 */
function permissionHelp(): string {
  const who = app.isPackaged ? `「${app.getName()}」` : '啟動喵助的終端機 App（例如 iTerm、終端機或 VS Code；開發模式下權限算在它身上）'
  return `沒有螢幕錄製權限。已幫使用者打開「系統設定 → 隱私權與安全性 → 螢幕與系統錄音」，請使用者把${who}打開，然後完全結束並重新啟動那個 App。之後再請我截圖就可以了。`
}

let openedSettings = false

export function missingPermission(): never {
  // Take the user straight to the right pane, once per run, instead of describing where it is.
  if (!openedSettings) {
    openedSettings = true
    void shell.openExternal(SCREEN_SETTINGS_URL)
  }
  throw new ToolError(permissionHelp())
}

export const screenshot: ToolDef = {
  spec: {
    name: 'screenshot',
    description: '擷取使用者目前的螢幕畫面，讓你看到畫面內容（例如協助看錯誤訊息、說明介面操作）。',
    parameters: {
      type: 'object',
      properties: { display: { type: 'integer', description: '多螢幕時第幾個螢幕（從 1 開始），預設為主螢幕' } }
    }
  },
  risk: 'screen',
  title: () => '擷取螢幕畫面',
  detail: () => '喵助會看到你目前螢幕上的所有內容（貓咪本身會先暫時隱藏）。',
  async run(i, ctx) {
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') missingPermission()
    const displays = screen.getAllDisplays()
    const index = Number(i.display) || 0
    const target = (index >= 1 && displays[index - 1]) || screen.getPrimaryDisplay()
    const size = { width: Math.round(target.size.width * target.scaleFactor), height: Math.round(target.size.height * target.scaleFactor) }

    const showPet = await ctx.hidePet()
    let sources: Electron.DesktopCapturerSource[]
    try {
      sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    } finally {
      showPet()
    }
    const source = sources.find((s) => s.display_id === String(target.id)) ?? sources[0]
    // macOS returns an empty image (not an error) when permission hasn't been granted.
    if (!source || source.thumbnail.isEmpty()) missingPermission()

    const { width, height } = source.thumbnail.getSize()
    return {
      text: `已擷取螢幕畫面（${width}×${height}），圖片附在下一則訊息。`,
      summary: `${width}×${height}`,
      images: [imageToDataUrl(source.thumbnail)]
    }
  }
}
