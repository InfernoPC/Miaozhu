import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { PET_SKINS, PET_STATES, type LoadedSkin, type PetState, type SkinView } from '@shared/types'
import { isInside } from '../tools/paths'
import { run } from '../util/run'

const MAX_FILE_BYTES = 5 * 1024 ** 2
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Shown through <img>, where SVG scripts never run.
  '.svg': 'image/svg+xml'
}

interface Manifest {
  name: string
  author?: string
  renderer: 'lottie' | 'images'
  width: number
  height: number
  /** state → absolute path, already validated to sit inside the pack. */
  files: Partial<Record<PetState, string>>
}

const skinsDir = () => join(app.getPath('userData'), 'skins')
const stagingDir = () => join(app.getPath('userData'), 'skins-staging')
const BUILTIN_IDS = new Set(PET_SKINS.map((s) => s.id))

const clampSize = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 40 && v <= 400 ? Math.round(v) : fallback)

/** Reads and checks a skin pack folder; throws a message a designer can act on. */
export function readSkinPack(dir: string): Manifest {
  const file = join(dir, 'skin.json')
  if (!existsSync(file)) throw new Error('找不到 skin.json')
  let m: any
  try {
    m = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`skin.json 不是有效的 JSON：${(e as Error).message}`)
  }
  if (typeof m?.name !== 'string' || !m.name.trim()) throw new Error('skin.json 缺少 name')
  if (m.renderer !== 'lottie' && m.renderer !== 'images') throw new Error('skin.json 的 renderer 必須是 "lottie" 或 "images"')
  if (!m.states || typeof m.states !== 'object') throw new Error('skin.json 缺少 states')

  const root = realpathSync(dir)
  const files: Manifest['files'] = {}
  for (const [state, rel] of Object.entries(m.states as Record<string, unknown>)) {
    if (!PET_STATES.includes(state as PetState)) throw new Error(`不認識的狀態「${state}」，可用：${PET_STATES.join('、')}`)
    if (typeof rel !== 'string' || !rel) throw new Error(`狀態「${state}」的檔名不正確`)
    const abs = join(dir, rel)
    if (!existsSync(abs)) throw new Error(`找不到「${state}」的檔案：${rel}`)
    // Resolved, so neither ../ nor a symlink can reach outside the pack.
    if (!isInside(realpathSync(abs), root)) throw new Error(`「${state}」的檔案必須放在造型資料夾裡：${rel}`)
    const ext = extname(rel).toLowerCase()
    if (m.renderer === 'lottie' ? ext !== '.json' : !(ext in IMAGE_TYPES)) {
      throw new Error(m.renderer === 'lottie' ? `Lottie 造型的檔案要是 .json：${rel}` : `不支援的圖片格式：${rel}（可用 png、jpg、gif、webp、svg）`)
    }
    if (statSync(abs).size > MAX_FILE_BYTES) throw new Error(`檔案太大（上限 5 MB）：${rel}`)
    files[state as PetState] = abs
  }
  if (!files.idle) throw new Error('至少要有 idle（待機）狀態')
  return {
    name: m.name.trim(),
    author: typeof m.author === 'string' ? m.author : undefined,
    renderer: m.renderer,
    width: clampSize(m.width, 200),
    height: clampSize(m.height, 180),
    files
  }
}

const idOf = (name: string) => {
  const id = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `skin-${Date.now()}`
  // Never shadow a built-in cat.
  return BUILTIN_IDS.has(id) ? `${id}-pack` : id
}

/** Installed skin packs plus the built-in cats. */
export class SkinPackManager {
  list(): SkinView[] {
    const builtins: SkinView[] = PET_SKINS.map((s) => ({ id: s.id, name: s.label, builtin: true }))
    if (!existsSync(skinsDir())) return builtins
    const packs = readdirSync(skinsDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e): SkinView[] => {
        try {
          const m = readSkinPack(join(skinsDir(), e.name))
          return [{ id: e.name, name: m.name, author: m.author, builtin: false, renderer: m.renderer, states: Object.keys(m.files) as PetState[] }]
        } catch {
          return [] // a broken pack is skipped, not fatal
        }
      })
    return [...builtins, ...packs]
  }

  load(id: string): LoadedSkin | null {
    if (BUILTIN_IDS.has(id) || !/^[a-z0-9._-]+$/.test(id)) return null
    const dir = join(skinsDir(), id)
    if (!existsSync(dir)) return null
    const m = readSkinPack(dir)
    const states: LoadedSkin['states'] = {}
    for (const [state, abs] of Object.entries(m.files) as [PetState, string][]) {
      const buf = readFileSync(abs)
      states[state] =
        m.renderer === 'lottie'
          ? { kind: 'lottie', data: JSON.parse(buf.toString('utf8')) }
          : { kind: 'image', src: `data:${IMAGE_TYPES[extname(abs).toLowerCase()]};base64,${buf.toString('base64')}` }
    }
    return { id, renderer: m.renderer, width: m.width, height: m.height, states }
  }

  /** Copies (or unpacks) a pack, validates it, then installs it under an id from its name. */
  async install(source: { kind: 'folder' | 'zip'; path: string }): Promise<string> {
    const stage = join(stagingDir(), randomUUID())
    mkdirSync(stage, { recursive: true })
    try {
      if (source.kind === 'folder') cpSync(source.path, join(stage, basename(source.path)), { recursive: true })
      else await run('tar', ['-xf', source.path, '-C', stage], stage, 60_000)
      // The pack may sit at the top of the zip or one folder down.
      const candidates = [stage, ...readdirSync(stage, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(stage, e.name))]
      const root = candidates.find((d) => existsSync(join(d, 'skin.json')))
      if (!root) throw new Error('裡面找不到 skin.json')
      const m = readSkinPack(root)
      const id = idOf(m.name)
      mkdirSync(skinsDir(), { recursive: true })
      rmSync(join(skinsDir(), id), { recursive: true, force: true })
      renameSync(root, join(skinsDir(), id))
      return id
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  }

  remove(id: string): void {
    if (BUILTIN_IDS.has(id) || !/^[a-z0-9._-]+$/.test(id)) return
    rmSync(join(skinsDir(), id), { recursive: true, force: true })
  }
}
