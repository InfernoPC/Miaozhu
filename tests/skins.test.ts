import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readSkinPack, SkinPackManager } from '../src/main/skins/skin-packs'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
})
afterAll(() => sb.cleanup())

const EXAMPLE = resolve(__dirname, '../skins/examples/night-cat')

function pack(name: string, manifest: object, files: Record<string, string | Buffer> = { 'idle.png': 'PNG' }): string {
  const dir = sb.path('packs', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'skin.json'), JSON.stringify(manifest))
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c)
  return dir
}

describe('reading a skin pack', () => {
  it('accepts the bundled example', () => {
    const m = readSkinPack(EXAMPLE)
    expect(m).toMatchObject({ name: '夜貓', renderer: 'images', width: 200, height: 180 })
    expect(Object.keys(m.files)).toContain('sleeping')
  })

  it('explains what is wrong, in terms a designer can fix', () => {
    expect(() => readSkinPack(pack('a', { name: 'x', renderer: 'video', states: {} }))).toThrow('renderer')
    expect(() => readSkinPack(pack('b', { name: 'x', renderer: 'images', states: { thinking: 'idle.png' } }))).toThrow('idle')
    expect(() => readSkinPack(pack('c', { name: 'x', renderer: 'images', states: { idle: 'idle.png', dancing: 'idle.png' } }))).toThrow('不認識的狀態')
    expect(() => readSkinPack(pack('d', { name: 'x', renderer: 'images', states: { idle: 'missing.png' } }))).toThrow('找不到')
    expect(() => readSkinPack(pack('e', { name: 'x', renderer: 'lottie', states: { idle: 'idle.png' } }))).toThrow('.json')
    expect(() => readSkinPack(pack('f', { name: 'x', renderer: 'images', states: { idle: 'idle.bmp' } }, { 'idle.bmp': 'B' }))).toThrow('不支援的圖片格式')
  })

  it('refuses files outside the pack, by ../ or by symlink', () => {
    writeFileSync(sb.path('outside.png'), 'x')
    expect(() => readSkinPack(pack('g', { name: 'x', renderer: 'images', states: { idle: '../../outside.png' } }))).toThrow('必須放在造型資料夾裡')
    const dir = pack('h', { name: 'x', renderer: 'images', states: { idle: 'link.png' } }, {})
    symlinkSync(sb.path('.ssh', 'id_rsa'), join(dir, 'link.png'))
    expect(() => readSkinPack(dir)).toThrow('必須放在造型資料夾裡')
  })

  it('refuses files over 5 MB', () => {
    expect(() => readSkinPack(pack('i', { name: 'x', renderer: 'images', states: { idle: 'idle.png' } }, { 'idle.png': Buffer.alloc(5 * 1024 ** 2 + 1) }))).toThrow('太大')
  })
})

describe('installing and loading', () => {
  it('lists the built-in cats first, then installed packs', async () => {
    const skins = new SkinPackManager()
    expect(skins.list().map((s) => s.id)).toEqual(['desk', 'classic'])
    const id = await skins.install({ kind: 'folder', path: EXAMPLE })
    expect(skins.list().map((s) => [s.id, s.builtin])).toEqual([
      ['desk', true],
      ['classic', true],
      [id, false]
    ])
  })

  it('loads every state as data the UI can draw without file access', async () => {
    const skins = new SkinPackManager()
    const id = await skins.install({ kind: 'folder', path: EXAMPLE })
    const loaded = skins.load(id)!
    expect(loaded.states.idle).toMatchObject({ kind: 'image' })
    expect((loaded.states.idle as { src: string }).src).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('loads Lottie packs as parsed JSON', async () => {
    const dir = pack('lottie', { name: 'Bouncy', renderer: 'lottie', states: { idle: 'idle.json' } }, { 'idle.json': JSON.stringify({ v: '5.7.0', fr: 30, ip: 0, op: 30, w: 200, h: 180, layers: [] }) })
    const skins = new SkinPackManager()
    const id = await skins.install({ kind: 'folder', path: dir })
    expect(skins.load(id)!.states.idle).toEqual({ kind: 'lottie', data: expect.objectContaining({ w: 200 }) })
  })

  it.skipIf(process.platform === 'win32')('installs from a zip, with the pack one folder down', async () => {
    const zip = sb.path('night.zip')
    execFileSync('tar', ['-a', '-cf', zip, '-C', resolve(EXAMPLE, '..'), 'night-cat'])
    const id = await new SkinPackManager().install({ kind: 'zip', path: zip })
    expect(new SkinPackManager().load(id)).not.toBeNull()
  })

  it('never lets a pack take a built-in id, and never removes a built-in', async () => {
    const skins = new SkinPackManager()
    const id = await skins.install({ kind: 'folder', path: pack('d', { name: 'desk', renderer: 'images', states: { idle: 'idle.png' } }) })
    expect(id).toBe('desk-pack')
    skins.remove('desk')
    expect(skins.list().some((s) => s.id === 'desk' && s.builtin)).toBe(true)
    expect(skins.load('desk')).toBeNull()
  })

  it('removes an installed pack', async () => {
    const skins = new SkinPackManager()
    const id = await skins.install({ kind: 'folder', path: EXAMPLE })
    skins.remove(id)
    expect(skins.load(id)).toBeNull()
  })

  it('rejects a folder without skin.json', async () => {
    mkdirSync(sb.path('empty'))
    await expect(new SkinPackManager().install({ kind: 'folder', path: sb.path('empty') })).rejects.toThrow('skin.json')
  })
})
