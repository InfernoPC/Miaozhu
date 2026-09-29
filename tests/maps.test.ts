import { shell } from './mocks/electron'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../src/main/agent/prompt'
import { findTool } from '../src/main/tools'
import { directionsUrl } from '../src/main/tools/maps'
import type { ToolContext } from '../src/main/tools/types'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
beforeAll(() => {
  sb = makeSandbox()
})
afterAll(() => sb.cleanup())

const ctx = (provider: 'serper' | 'none', apiKey?: string): ToolContext => ({
  signal: new AbortController().signal,
  search: () => ({ config: { provider }, apiKey }),
  isBlocked: () => false,
  hidePet: async () => () => {}
})

describe('maps_search_places', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('searches Google Maps via Serper and lists rating, reviews, address and a map link', async () => {
    let sent: any
    globalThis.fetch = (async (url: string, init: any) => {
      sent = { url, key: init.headers['x-api-key'], body: JSON.parse(init.body) }
      return new Response(
        JSON.stringify({
          places: [
            { title: '一蘭拉麵', address: '台北市信義區松仁路 97 號', rating: 4.3, ratingCount: 5210, category: '拉麵店', cid: '1234567890', openingHours: { Monday: '24 小時營業' } },
            { title: '無評分小店', address: '台北市某處' }
          ]
        })
      )
    }) as typeof fetch

    const r = await findTool('maps_search_places')!.run({ query: '拉麵', near: '台北 101' }, ctx('serper', 'k'))
    expect(sent).toMatchObject({ url: 'https://google.serper.dev/maps', key: 'k', body: { q: '拉麵 near 台北 101', gl: 'tw' } })
    expect(r.text).toContain('一蘭拉麵｜★4.3（5210 則評論）')
    expect(r.text).toContain('https://maps.google.com/?cid=1234567890')
    // No id: fall back to a Maps search link for the name and address.
    expect(r.text).toContain('https://www.google.com/maps/search/?api=1&query=')
    expect(r.text).toContain('沒有評分')
    expect(r.summary).toBe('2 個地點')
  })

  it('says how to set it up when Serper is not the chosen search service', async () => {
    await expect(findTool('maps_search_places')!.run({ query: '咖啡' }, ctx('none'))).rejects.toThrow('Google（透過 Serper）')
  })

  it('reports an invalid key clearly', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch
    await expect(findTool('maps_search_places')!.run({ query: '咖啡' }, ctx('serper', 'bad'))).rejects.toThrow('API Key 無效')
  })
})

describe('maps_directions', () => {
  it('builds a Google Maps directions link', () => {
    const url = new URL(directionsUrl('台北 101', '台北車站', 'transit'))
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ api: '1', destination: '台北 101', origin: '台北車站', travelmode: 'transit' })
  })

  it('leaves out the origin so Google Maps starts from the current location, and ignores unknown modes', () => {
    const url = new URL(directionsUrl('台北 101', undefined, 'teleport'))
    expect(url.searchParams.has('origin')).toBe(false)
    expect(url.searchParams.has('travelmode')).toBe(false)
  })

  it('opens the route in the browser without asking', async () => {
    shell.opened.length = 0
    const r = await findTool('maps_directions')!.run({ destination: '台北 101', travel_mode: 'walking' }, ctx('none'))
    expect(shell.opened[0]).toContain('https://www.google.com/maps/dir/?api=1&destination=')
    expect(r.summary).toContain('步行')
    expect(findTool('maps_directions')!.risk).toBe('network')
  })
})

describe('saved places in the system prompt', () => {
  it('lists saved places, with the first as the default "near me"', () => {
    const prompt = buildSystemPrompt(undefined, [
      { name: '公司', address: '新北市汐止區新台五路 1 段 1 號' },
      { name: '家', address: '台北市大安區' }
    ])
    expect(prompt).toContain('公司＝新北市汐止區新台五路 1 段 1 號；家＝台北市大安區')
    expect(prompt).toContain('用第一個')
  })

  it('tells the model to ask when no place is saved', () => {
    expect(buildSystemPrompt(undefined, [])).toContain('先問使用者')
  })
})
