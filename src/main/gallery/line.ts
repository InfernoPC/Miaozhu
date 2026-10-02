import { net } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LINE sticker sets, downloaded from LINE's sticker CDN. The store pages are rendered in the
 * browser now (the sticker list is no longer in the HTML that meme_gallery parsed), so this
 * reads the set's productInfo.meta and fetches each sticker by id. Only URLs built here, on
 * LINE's CDN, are ever requested.
 */
const CDN = 'https://stickershop.line-scdn.net/stickershop/v1'
const PARALLEL = 4

/** A store link, a share link (line.me/S/sticker/123) or just the number → the set's id. */
export function lineStickerId(input: string): string {
  const s = input.trim()
  const m =
    s.match(/^https?:\/\/store\.line\.me\/stickershop\/product\/(\d+)/i) ??
    s.match(/^https?:\/\/line\.me\/S\/sticker\/(\d+)/i) ??
    s.match(/^(\d{1,12})$/)
  if (!m) throw new Error('請貼上 LINE 貼圖的網址，例如 https://store.line.me/stickershop/product/12345/zh-Hant')
  return m[1]
}

interface ProductInfo {
  packageId: number
  title?: Record<string, string>
  stickers?: { id: number }[]
  hasAnimation?: boolean
  stickerResourceType?: string
}

/** The image to fetch for one sticker, best first: the moving one for animated sets. */
export function stickerUrls(id: number, info: Pick<ProductInfo, 'hasAnimation' | 'stickerResourceType'>): string[] {
  const base = `${CDN}/sticker/${id}`
  const still = [`${base}/iPhone/sticker@2x.png`, `${base}/android/sticker.png`]
  const type = info.stickerResourceType ?? ''
  if (type.includes('POPUP')) return [`${base}/iPhone/sticker_popup.png`, `${base}/iPhone/sticker_animation@2x.png`, ...still]
  if (info.hasAnimation || type.includes('ANIMATION')) return [`${base}/iPhone/sticker_animation@2x.png`, `${base}/android/sticker_animation.png`, ...still]
  return still
}

export interface LineDownload {
  title: string
  /** Absolute folder the stickers went into. */
  folder: string
  saved: number
  skipped: number
  failed: number
}

type Fetch = (url: string) => Promise<Response>

/**
 * Downloads a set into `<parent>/<title>`. Files already there are kept, so running it again
 * only fills in what's missing.
 */
export async function downloadLineStickers(
  input: string,
  parentDir: string,
  folderName: (title: string) => string,
  onProgress: (done: number, total: number, title: string) => void,
  fetchFn: Fetch = (url) => net.fetch(url)
): Promise<LineDownload> {
  const id = lineStickerId(input)
  const res = await fetchFn(`${CDN}/product/${id}/android/productInfo.meta`)
  if (res.status === 404) throw new Error('找不到這組貼圖，請確認網址（目前只支援貼圖，不支援表情貼）')
  if (!res.ok) throw new Error(`LINE 回應 ${res.status}，請稍後再試`)
  const info = (await res.json()) as ProductInfo
  const stickers = info.stickers ?? []
  if (!stickers.length) throw new Error('這組貼圖裡沒有可以下載的圖')
  const t = info.title ?? {}
  const title = t.zh_TW || t.en || t.ja || Object.values(t)[0] || `LINE 貼圖 ${id}`

  const folder = join(parentDir, folderName(title))
  mkdirSync(folder, { recursive: true })
  const result: LineDownload = { title, folder, saved: 0, skipped: 0, failed: 0 }
  let done = 0
  onProgress(0, stickers.length, title)

  const one = async (index: number) => {
    const file = join(folder, `line_sticker_${String(index + 1).padStart(2, '0')}.png`)
    if (existsSync(file)) {
      result.skipped++
      return
    }
    for (const url of stickerUrls(stickers[index].id, info)) {
      try {
        const r = await fetchFn(url)
        if (!r.ok) continue
        const bytes = Buffer.from(await r.arrayBuffer())
        // The CDN answers 200 with an empty body for images a set doesn't have.
        if (!bytes.length) continue
        writeFileSync(file, bytes)
        result.saved++
        return
      } catch {
        // Try the next form of this sticker.
      }
    }
    result.failed++
  }

  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, stickers.length) }, async () => {
      while (next < stickers.length) {
        await one(next++)
        onProgress(++done, stickers.length, title)
      }
    })
  )
  return result
}
