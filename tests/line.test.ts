import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { folderNameFor } from '../src/main/gallery/library'
import { downloadLineStickers, lineStickerId, stickerUrls } from '../src/main/gallery/line'
import { makeSandbox } from './helpers/sandbox'

const sb = makeSandbox()
afterAll(() => sb.cleanup())

/** A fake LINE CDN: a set with three stickers; sticker 2 has no animation (empty body). */
function fakeCdn(meta: object | 404) {
  const requested: string[] = []
  const fetchFn = async (url: string) => {
    requested.push(url)
    if (url.endsWith('productInfo.meta')) return meta === 404 ? new Response('', { status: 404 }) : Response.json(meta)
    if (url.includes('/sticker/2/') && url.includes('animation')) return new Response(new Uint8Array(0))
    return new Response(`img:${url.split('/sticker/')[1]}`)
  }
  return { fetchFn, requested }
}
const meta = { packageId: 99, title: { en: 'Cats', zh_TW: '貓咪：動態/特別篇' }, stickers: [{ id: 1 }, { id: 2 }, { id: 3 }], hasAnimation: true, stickerResourceType: 'ANIMATION' }

describe('LINE sticker links', () => {
  it('takes store links, share links and bare ids', () => {
    expect(lineStickerId('https://store.line.me/stickershop/product/11537/zh-Hant')).toBe('11537')
    expect(lineStickerId('https://line.me/S/sticker/11537')).toBe('11537')
    expect(lineStickerId(' 11537 ')).toBe('11537')
    expect(() => lineStickerId('https://evil.example/stickershop/product/1')).toThrow('LINE 貼圖的網址')
  })

  it('prefers the moving image for animated sets', () => {
    expect(stickerUrls(5, { hasAnimation: true })[0]).toMatch(/sticker\/5\/iPhone\/sticker_animation@2x\.png$/)
    expect(stickerUrls(5, { hasAnimation: false })[0]).toMatch(/sticker@2x\.png$/)
    expect(stickerUrls(5, { stickerResourceType: 'POPUP' })[0]).toMatch(/sticker_popup\.png$/)
  })
})

describe('downloading a set', () => {
  it('saves every sticker into a folder named after the set, only ever asking LINE’s CDN', async () => {
    const { fetchFn, requested } = fakeCdn(meta)
    const progress: number[] = []
    const r = await downloadLineStickers('https://store.line.me/stickershop/product/99/zh-Hant', sb.path('gallery'), folderNameFor, (d) => progress.push(d), fetchFn)
    expect(r).toMatchObject({ title: '貓咪：動態/特別篇', saved: 3, skipped: 0, failed: 0 })
    expect(r.folder).toBe(sb.path('gallery', '貓咪：動態_特別篇'))
    expect(readdirSync(r.folder).sort()).toEqual(['line_sticker_01.png', 'line_sticker_02.png', 'line_sticker_03.png'])
    expect(readFileSync(join(r.folder, 'line_sticker_01.png'), 'utf8')).toContain('1/iPhone/sticker_animation@2x.png')
    // No animation for sticker 2: falls back to the still image.
    expect(readFileSync(join(r.folder, 'line_sticker_02.png'), 'utf8')).toContain('2/iPhone/sticker@2x.png')
    expect(requested.every((u) => u.startsWith('https://stickershop.line-scdn.net/'))).toBe(true)
    expect(progress.at(-1)).toBe(3)
  })

  it('a second run only fills in what is missing', async () => {
    const { fetchFn } = fakeCdn(meta)
    const folder = sb.path('gallery', '貓咪：動態_特別篇')
    writeFileSync(join(folder, 'line_sticker_01.png'), 'mine')
    const r = await downloadLineStickers('99', sb.path('gallery'), folderNameFor, () => {}, fetchFn)
    expect(r).toMatchObject({ saved: 0, skipped: 3 })
    expect(readFileSync(join(folder, 'line_sticker_01.png'), 'utf8')).toBe('mine')
  })

  it('explains a set that does not exist', async () => {
    const { fetchFn } = fakeCdn(404)
    await expect(downloadLineStickers('12345', sb.path('gallery'), folderNameFor, () => {}, fetchFn)).rejects.toThrow('找不到這組貼圖')
    expect(existsSync(sb.path('gallery', 'LINE 貼圖 12345'))).toBe(false)
  })
})
