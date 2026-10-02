import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clipboard } from 'electron'
import type { GalleryTagStatus, ProviderProfile } from '@shared/types'
import { copyImage } from '../src/main/gallery/copy'
import { GalleryLibrary, isAnimated } from '../src/main/gallery/library'
import { GalleryTags, parseTags } from '../src/main/gallery/tags'
import type { LLMProvider } from '../src/main/providers/types'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

const GIF = Buffer.from('R0lGODlhAgACAPAAAP8AAAAAACH5BAAKAAAALAAAAAACAAIAAAIChFEAOw==', 'base64')
/** PNG signature + an acTL chunk name: enough for the APNG check. */
const APNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('....IHDR........acTL....')])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('....IHDR........IDAT....')])

let sb: Sandbox
let root: string
let lib: GalleryLibrary

function put(rel: string, data: Buffer | string = PNG): string {
  const abs = join(root, ...rel.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, data)
  return abs
}

beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
  root = sb.path('Pictures', '喵助梗圖')
  lib = new GalleryLibrary(() => root)
  put('謝謝.png')
  put('動物/貓/好累.gif', GIF)
  put('動物/狗.apng', APNG)
  put('notes.txt', 'not an image')
  put('.miaozhu/tags.json', '{}')
})

describe('browsing', () => {
  it('lists folders (with a cover and a count) and images, hiding non-images and its own data', () => {
    const top = lib.list('')
    expect(top.folders).toEqual([{ name: '動物', rel: '動物', cover: '動物/狗.apng', imageCount: 1 }])
    expect(top.images.map((i) => i.name)).toEqual(['謝謝.png'])
    expect(lib.list('動物/貓').images[0]).toMatchObject({ rel: '動物/貓/好累.gif', animated: true })
  })

  it('knows which images move', () => {
    expect(isAnimated(join(root, '動物', '貓', '好累.gif'))).toBe(true)
    expect(isAnimated(join(root, '動物', '狗.apng'))).toBe(true)
    expect(isAnimated(join(root, '謝謝.png'))).toBe(false)
  })

  it('finds every image, skipping its own data folder', () => {
    expect(lib.allImages().map((i) => i.rel).sort()).toEqual(['動物/狗.apng', '動物/貓/好累.gif', '謝謝.png'])
  })

  it('never reaches outside the gallery, by ../, hidden folders or a symlink', () => {
    expect(() => lib.resolve('../../.ssh/id_rsa')).toThrow('不在梗圖庫裡')
    expect(() => lib.resolve('.miaozhu/tags.json')).toThrow('不在梗圖庫裡')
    symlinkSync(sb.path('.ssh'), join(root, 'link'))
    expect(() => lib.resolve('link/id_rsa')).toThrow('不在梗圖庫裡')
  })
})

describe('organizing', () => {
  it('renames, keeping the extension when only a name is typed', () => {
    expect(lib.rename('謝謝.png', '感謝')).toBe('感謝.png')
    expect(existsSync(join(root, '感謝.png'))).toBe(true)
    put('a.png')
    expect(() => lib.rename('a.png', '感謝')).toThrow('已經有「感謝.png」了')
    // Path tricks become plain characters; a leading dot (hidden file) is refused.
    expect(lib.rename('a.png', 'x/../y')).toBe('x_.._y.png')
    expect(() => lib.rename('x_.._y.png', '../z')).toThrow('不能用 . 開頭')
  })

  it('moves, but not a folder into itself, and never over an existing file', () => {
    expect(lib.move('謝謝.png', '動物')).toBe('動物/謝謝.png')
    expect(() => lib.move('動物', '動物/貓')).toThrow('不能搬到自己')
    put('動物/貓/謝謝.png')
    expect(() => lib.move('動物/謝謝.png', '動物/貓')).toThrow('已經有「謝謝.png」了')
  })

  it('makes folders with clean names', () => {
    expect(lib.mkdir('', '工作/用')).toBe('工作_用')
    expect(() => lib.mkdir('', '工作_用')).toThrow('同名')
    expect(() => lib.mkdir('', '.hidden')).toThrow()
  })

  it('deletes to the trash', async () => {
    await lib.remove('謝謝.png')
    expect(existsSync(join(root, '謝謝.png'))).toBe(false)
    expect(existsSync(sb.path('.Trash', '謝謝.png'))).toBe(true)
  })

  it('imports only images, without overwriting', () => {
    const outside = sb.path('Downloads')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, '謝謝.png'), 'new')
    writeFileSync(join(outside, 'virus.exe'), 'x')
    expect(lib.importFiles([join(outside, '謝謝.png'), join(outside, 'virus.exe')], '')).toBe(1)
    expect(readFileSync(join(root, '謝謝 (2).png'), 'utf8')).toBe('new')
  })

  it('saves pasted image bytes into a folder', () => {
    const rel = lib.saveImage(Buffer.from('img'), '.png', '動物')
    expect(rel).toMatch(/^動物\/貼上 .+\.png$/)
  })
})

describe('copying', () => {
  const written = () => (clipboard as unknown as { written: { types: string[] }[] }).written[0].types

  it('a still image goes as a picture', async () => {
    expect(await copyImage(join(root, '謝謝.png'))).toBe('image')
    expect(written()).toEqual(['image/png'])
  })

  it('a GIF / APNG goes as a file, so it keeps moving where it is pasted', async () => {
    expect(await copyImage(join(root, '動物', '貓', '好累.gif'))).toBe('file')
    expect(written()).toContain('text/uri-list')
    expect(await copyImage(join(root, '動物', '狗.apng'))).toBe('file')
  })
})

describe('tags', () => {
  const profile: ProviderProfile = { id: 'p', name: '測試', kind: 'openai-compatible', baseURL: 'http://x', model: 'vision-1' }
  function fakeProvider(answer: (n: number) => string | Error): LLMProvider & { calls: number } {
    const p = {
      profile,
      calls: 0,
      async *stream() {
        const a = answer(++p.calls)
        if (a instanceof Error) throw a
        yield { type: 'text' as const, text: a }
      },
      listModels: async () => []
    }
    return p as unknown as LLMProvider & { calls: number }
  }
  function tagger(provider: LLMProvider, sensitive = false) {
    const statuses: GalleryTagStatus[] = []
    const tags = new GalleryTags(lib, { model: () => ({ profile, provider }), inSensitiveFolder: async () => sensitive, onStatus: (s) => statuses.push(s) })
    return { tags, statuses }
  }
  const json = (d: string, t: string[]) => JSON.stringify({ description: d, tags: t, text: '' })

  it('reads the model answer, even with a code fence around it', () => {
    expect(parseTags('```json\n{"description":"貓","tags":["累","貓"," "],"text":"好累"}\n```')).toEqual({ description: '貓', tags: ['累', '貓'], text: '好累' })
    expect(() => parseTags('我看不到圖')).toThrow('JSON')
  })

  it('tags every image once, stores it with the gallery, and searches by tag', async () => {
    const provider = fakeProvider((n) => json(`圖 ${n}`, n === 1 ? ['辛苦了', '累'] : ['謝謝']))
    const { tags, statuses } = tagger(provider)
    await tags.run()
    expect(provider.calls).toBe(3)
    expect(statuses.at(-1)).toMatchObject({ state: 'idle', tagged: 3, images: 3 })
    expect(JSON.parse(readFileSync(join(root, '.miaozhu', 'tags.json'), 'utf8')).entries).toHaveProperty(['謝謝.png'])
    // Already tagged: nothing to do.
    await tags.run()
    expect(provider.calls).toBe(3)
    const hit = tags.search('辛苦了')
    expect(hit).toHaveLength(1)
    expect(hit[0].tags).toContain('辛苦了')
    // Every word must match; folder names count too.
    expect(tags.search('動物 謝謝').length).toBeLessThanOrEqual(2)
    expect(tags.search('貓').map((i) => i.rel)).toContain('動物/貓/好累.gif')
  })

  it('keeps tags with a renamed file, and drops them for a changed one', async () => {
    const { tags } = tagger(fakeProvider(() => json('x', ['謝謝'])))
    await tags.run()
    const next = lib.rename('謝謝.png', '感謝')
    tags.moved('謝謝.png', next)
    expect(tags.annotate(lib.list('').images)[0].tags).toEqual(['謝謝'])
    put('感謝.png', Buffer.from('a different picture, a different size'))
    expect(tags.annotate(lib.list('').images)[0].tags).toBeUndefined()
  })

  it('stops with a clear message when the model cannot see images', async () => {
    const err = Object.assign(new Error('400 This model does not support image input'), { status: 400 })
    const provider = fakeProvider(() => err)
    const { tags, statuses } = tagger(provider)
    await tags.run()
    expect(provider.calls).toBe(1)
    expect(statuses.at(-1)).toMatchObject({ state: 'error' })
    expect(statuses.at(-1)!.message).toContain('不支援看圖')
  })

  it('gives up after three failures in a row', async () => {
    const provider = fakeProvider(() => Object.assign(new Error('boom'), { status: 500 }))
    const { tags, statuses } = tagger(provider)
    await tags.run()
    expect(provider.calls).toBe(3)
    expect(statuses.at(-1)!.message).toContain('連續失敗')
  })

  it('a gallery in a sensitive folder is only tagged by a local model', async () => {
    const provider = fakeProvider(() => json('x', ['a']))
    const { tags, statuses } = tagger(provider, true)
    await tags.run()
    expect(provider.calls).toBe(0)
    expect(statuses.at(-1)!.message).toContain('敏感資料夾')
  })
})
