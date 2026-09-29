import { shell } from 'electron'
import { ToolError, type ToolDef } from './types'

const FETCH_TIMEOUT_MS = 15_000
const TRAVEL_MODES = ['driving', 'walking', 'transit', 'bicycling'] as const
const MODE_LABEL: Record<(typeof TRAVEL_MODES)[number], string> = { driving: '開車', walking: '步行', transit: '大眾運輸', bicycling: '騎車' }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export interface Place {
  title: string
  address?: string
  rating?: number
  ratingCount?: number
  category?: string
  phone?: string
  website?: string
  hours?: string
  mapsUrl: string
}

/** A link that opens the place itself when Google gave us its id, else a search for it. */
function placeLink(p: { cid?: unknown; title: string; address?: string }): string {
  if (typeof p.cid === 'string' && /^\d+$/.test(p.cid)) return `https://maps.google.com/?cid=${p.cid}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.title, p.address].filter(Boolean).join(' '))}`
}

/** Opening hours come back in a few shapes; reduce them to one readable line when possible. */
function hoursText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    const value = (raw as Record<string, unknown>)[today]
    if (typeof value === 'string') return `今天 ${value}`
  }
  return undefined
}

export function parsePlaces(data: any, max: number): Place[] {
  return (Array.isArray(data?.places) ? data.places : []).slice(0, max).map((p: any) => ({
    title: String(p.title ?? ''),
    address: p.address,
    rating: typeof p.rating === 'number' ? p.rating : undefined,
    ratingCount: typeof p.ratingCount === 'number' ? p.ratingCount : undefined,
    category: p.category ?? p.type,
    phone: p.phoneNumber,
    website: p.website,
    hours: hoursText(p.openingHours),
    mapsUrl: placeLink(p)
  }))
}

export const mapsSearchPlaces: ToolDef = {
  spec: {
    name: 'maps_search_places',
    description:
      '用 Google 地圖搜尋地點（餐廳、咖啡廳、公司、景點…），回傳評分、評論數、地址與地圖連結。「附近」請用 near 指定地點：使用者的常用地點見系統說明，沒有的話先問使用者在哪裡。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要找什麼，例如「拉麵」「會議室出租」' },
        near: { type: 'string', description: '在哪裡附近：地址、地標或區域，例如「台北市信義區市府路 1 號」' },
        max_results: { type: 'integer', description: '結果數量，預設 5，最多 10' }
      },
      required: ['query']
    }
  },
  risk: 'network',
  title: (i) => `搜尋地圖：${str(i.query)}${str(i.near) ? `（${str(i.near)}附近）` : ''}`,
  async run(i, ctx) {
    const { config, apiKey } = ctx.search()
    if (config.provider !== 'serper' || !apiKey) {
      throw new ToolError('地點搜尋需要 Serper：請使用者到「設定 → 網路搜尋」選擇「Google（透過 Serper）」並填入 API Key。')
    }
    const max = Math.min(10, Math.max(1, Number(i.max_results) || 5))
    const q = str(i.near) ? `${str(i.query)} near ${str(i.near)}` : str(i.query)
    const res = await fetch('https://google.serper.dev/maps', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ q, gl: 'tw', hl: 'zh-tw' }),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    })
    if (res.status === 401 || res.status === 403) throw new ToolError(`Serper API Key 無效（HTTP ${res.status}）`)
    if (!res.ok) throw new ToolError(`地點搜尋失敗（HTTP ${res.status}）`)
    const places = parsePlaces(await res.json(), max)
    if (!places.length) return { text: '沒有找到符合的地點', summary: '沒有結果' }

    const lines = places.map((p, n) => {
      const score = p.rating !== undefined ? `★${p.rating}${p.ratingCount !== undefined ? `（${p.ratingCount} 則評論）` : ''}` : '沒有評分'
      const extra = [p.category, p.hours, p.phone].filter(Boolean).join('｜')
      return `[${n + 1}] ${p.title}｜${score}\n${p.address ?? ''}${extra ? `\n${extra}` : ''}\n地圖：${p.mapsUrl}`
    })
    return { text: `${lines.join('\n\n')}\n\n回答時請附上地點的地圖連結。`, summary: `${places.length} 個地點` }
  }
}

/** A Google Maps directions link (documented "Maps URLs", no API key needed). */
export function directionsUrl(destination: string, origin?: string, mode?: string): string {
  const params = new URLSearchParams({ api: '1', destination })
  // Without an origin, Google Maps starts from the browser's current location.
  if (origin) params.set('origin', origin)
  if (mode && (TRAVEL_MODES as readonly string[]).includes(mode)) params.set('travelmode', mode)
  return `https://www.google.com/maps/dir/?${params}`
}

export const mapsDirections: ToolDef = {
  spec: {
    name: 'maps_directions',
    description:
      '在使用者的瀏覽器打開 Google 地圖路線規劃（含即時路況）。沒給 origin 時，Google 地圖會用使用者目前的位置當起點。',
    parameters: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: '目的地：地址、大樓或店名' },
        origin: { type: 'string', description: '起點（選填），例如使用者的常用地點地址' },
        travel_mode: { type: 'string', enum: [...TRAVEL_MODES], description: '交通方式，預設由 Google 地圖決定' }
      },
      required: ['destination']
    }
  },
  risk: 'network',
  title: (i) => `規劃路線：${str(i.origin) ? `${str(i.origin)} → ` : ''}${str(i.destination)}`,
  async run(i) {
    const mode = str(i.travel_mode)
    const url = directionsUrl(str(i.destination), str(i.origin) || undefined, mode || undefined)
    await shell.openExternal(url)
    const how = mode in MODE_LABEL ? `（${MODE_LABEL[mode as keyof typeof MODE_LABEL]}）` : ''
    return { text: `已在瀏覽器打開 Google 地圖路線${how}：${url}`, summary: `已打開地圖${how}` }
  }
}
