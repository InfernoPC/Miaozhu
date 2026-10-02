import { nativeImage } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { GalleryImageView, GalleryTagStatus, ProviderProfile } from '@shared/types'
import { describeError } from '../providers'
import { errorStatus } from '../providers/errors'
import type { LLMProvider } from '../providers/types'
import { readJson, writeJson } from '../util/json-file'
import { DATA_DIR, type GalleryLibrary } from './library'

const VERSION = 1
const TAG_SIDE = 512
/** A GIF is sent as is (models read its first frame); bigger ones are skipped. */
const MAX_RAW_BYTES = 3_500_000
const MAX_FAILURES_IN_A_ROW = 3
const PAUSE_BETWEEN_MS = 300

export const TAG_PROMPT = `你會看到一張梗圖或貼圖。請只回傳一個 JSON 物件，不要其他文字：
{"description": "一句話描述畫面（繁體中文）", "tags": ["3 到 8 個繁體中文關鍵字"], "text": "圖中的文字，沒有就空字串"}
tags 請包含情緒與適合使用的情境（例如：謝謝、辛苦了、好累、生氣、恭喜、加油、無言），以及畫面中的角色或物品。`

interface TagEntry {
  /** The file these tags were made for; a changed file gets tagged again. */
  size: number
  mtime: number
  description: string
  tags: string[]
  text: string
  model?: string
  at: string
}

interface IndexFile {
  version: number
  entries: Record<string, TagEntry>
}

export interface ImageTags {
  description: string
  tags: string[]
  text: string
}

/** The model's JSON answer → tags; tolerant of code fences and extra prose around it. */
export function parseTags(answer: string): ImageTags {
  const m = answer.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('模型沒有回傳 JSON')
  const o = JSON.parse(m[0]) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 500) : '')
  const tags = Array.isArray(o.tags) ? [...new Set(o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean))].slice(0, 12) : []
  const result = { description: str(o.description), tags, text: str(o.text) }
  if (!result.description && !tags.length) throw new Error('模型回傳的內容是空的')
  return result
}

const MIME: Record<string, string> = { '.png': 'image/png', '.apng': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/**
 * An image as the model sees it: a small JPEG when Electron can decode it, otherwise the file
 * as is (GIFs, and formats nativeImage can't read on this OS); models read a GIF's first frame.
 */
export function imageForModel(abs: string): string {
  const ext = extname(abs).toLowerCase()
  const img = ext === '.gif' ? null : nativeImage.createFromPath(abs)
  if (img && !img.isEmpty()) return smallJpeg(img)
  if (statSync(abs).size > MAX_RAW_BYTES) throw new Error('檔案太大，略過')
  return `data:${MIME[ext] ?? 'image/png'};base64,${readFileSync(abs).toString('base64')}`
}

function smallJpeg(img: Electron.NativeImage): string {
  const { width, height } = img.getSize()
  const scale = Math.min(1, TAG_SIDE / Math.max(width, height))
  const sized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img
  return `data:image/jpeg;base64,${sized.toJPEG(80).toString('base64')}`
}

export async function describeImage(provider: LLMProvider, dataUrl: string, signal?: AbortSignal): Promise<ImageTags> {
  let answer = ''
  for await (const ev of provider.stream({
    messages: [
      { role: 'system', text: TAG_PROMPT },
      { role: 'user', content: [{ type: 'image', dataUrl }, { type: 'text', text: '請描述這張圖。' }] }
    ],
    signal
  })) {
    if (ev.type === 'text') answer += ev.text
  }
  return parseTags(answer)
}

/** A refusal of the image itself, as opposed to a busy or failing server. */
function modelCantSeeImages(err: unknown): boolean {
  const status = errorStatus(err) ?? (err as { status?: unknown }).status
  const msg = String((err as { message?: string }).message ?? '')
  return (status === 400 || status === 404 || status === 415 || status === 422) && /image|vision|multimodal|modalit|content type|image_url/i.test(msg)
}

export interface TaggerDeps {
  /** The model to tag with; null when none is set up. */
  model: () => { profile: ProviderProfile; provider: LLMProvider } | null
  /** True when the gallery sits in a sensitive folder (then only a local model may see it). */
  inSensitiveFolder: () => Promise<boolean>
  onStatus: (s: GalleryTagStatus) => void
}

/** Tags stored with the gallery (in .miaozhu/tags.json), search over them, and the tagger. */
export class GalleryTags {
  private cache: { root: string; data: IndexFile } | null = null
  private running: AbortController | null = null
  private state: GalleryTagStatus = { state: 'idle', done: 0, total: 0, tagged: 0, images: 0 }

  constructor(
    private library: GalleryLibrary,
    private deps: TaggerDeps
  ) {}

  private path(root: string): string {
    return join(root, DATA_DIR, 'tags.json')
  }

  private index(): IndexFile {
    const root = this.library.root()
    if (this.cache?.root !== root) {
      const data = readJson<IndexFile>(this.path(root), { version: VERSION, entries: {} })
      this.cache = { root, data: data.version === VERSION && data.entries ? data : { version: VERSION, entries: {} } }
    }
    return this.cache.data
  }

  private save(): void {
    if (!this.cache) return
    try {
      writeJson(this.path(this.cache.root), this.cache.data)
    } catch {
      // A read-only gallery (e.g. a shared drive) can still be browsed, just not tagged.
    }
  }

  private current(img: GalleryImageView): TagEntry | undefined {
    const e = this.index().entries[img.rel]
    return e && e.size === img.size && Math.abs(e.mtime - img.mtime) < 2000 ? e : undefined
  }

  /** Adds stored tags to images from a listing. */
  annotate(images: GalleryImageView[]): GalleryImageView[] {
    return images.map((img) => {
      const e = this.current(img)
      return e ? { ...img, description: e.description, tags: e.tags, text: e.text } : img
    })
  }

  /** Every word of the query must match the name, folder, description, tags or text. */
  search(query: string, limit = 200): GalleryImageView[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const hits: { img: GalleryImageView; score: number }[] = []
    for (const img of this.annotate(this.library.allImages())) {
      const name = img.rel.toLowerCase()
      const tags = (img.tags ?? []).join(' ').toLowerCase()
      const rest = `${img.description ?? ''} ${img.text ?? ''}`.toLowerCase()
      if (!words.every((w) => name.includes(w) || tags.includes(w) || rest.includes(w))) continue
      // Tags and names first: they're what people search by.
      const score = words.reduce((s, w) => s + (tags.includes(w) ? 3 : 0) + (name.includes(w) ? 2 : 0) + (rest.includes(w) ? 1 : 0), 0)
      hits.push({ img, score })
    }
    return hits.sort((a, b) => b.score - a.score || a.img.rel.localeCompare(b.img.rel)).slice(0, limit).map((h) => h.img)
  }

  /** Keeps tags with a file or folder that was renamed or moved. */
  moved(fromRel: string, toRel: string): void {
    const entries = this.index().entries
    for (const key of Object.keys(entries)) {
      if (key === fromRel || key.startsWith(`${fromRel}/`)) {
        entries[toRel + key.slice(fromRel.length)] = entries[key]
        delete entries[key]
      }
    }
    this.save()
  }

  removed(rel: string): void {
    const entries = this.index().entries
    for (const key of Object.keys(entries)) if (key === rel || key.startsWith(`${rel}/`)) delete entries[key]
    this.save()
  }

  status(): GalleryTagStatus {
    const images = this.library.allImages()
    return { ...this.state, images: images.length, tagged: images.filter((i) => this.current(i)).length }
  }

  private emit(patch: Partial<GalleryTagStatus>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onStatus(this.status())
  }

  stop(): void {
    this.running?.abort()
  }

  /** Tags the images that have no (current) tags yet; `rels` limits it to those images. */
  async run(rels?: string[]): Promise<void> {
    if (this.running) return
    const model = this.deps.model()
    if (!model) return this.emit({ state: 'error', message: '還沒有可用的模型連線' })
    if (!model.profile.isLocal && (await this.deps.inSensitiveFolder())) {
      return this.emit({ state: 'error', message: '梗圖庫在敏感資料夾裡，只能用本機模型加標籤' })
    }
    const todo = this.library.allImages().filter((i) => (rels ? rels.includes(i.rel) : !this.current(i)))
    if (!todo.length) return this.emit({ state: 'idle', done: 0, total: 0, message: undefined })

    const controller = new AbortController()
    this.running = controller
    this.emit({ state: 'running', done: 0, total: todo.length, message: undefined })
    let failures = 0
    try {
      for (const [i, img] of todo.entries()) {
        if (controller.signal.aborted) return this.emit({ state: 'stopped', message: '已停止' })
        try {
          const abs = this.library.resolve(img.rel)
          const tags = await describeImage(model.provider, imageForModel(abs), controller.signal)
          this.index().entries[img.rel] = { size: img.size, mtime: img.mtime, ...tags, model: model.profile.model, at: new Date().toISOString() }
          this.save()
          failures = 0
        } catch (err) {
          if (controller.signal.aborted) return this.emit({ state: 'stopped', message: '已停止' })
          if (modelCantSeeImages(err)) {
            return this.emit({ state: 'error', message: `「${model.profile.name}」的模型（${model.profile.model}）不支援看圖，請在設定改用支援圖片的模型` })
          }
          if (++failures >= MAX_FAILURES_IN_A_ROW) return this.emit({ state: 'error', message: `連續失敗，已停止：${describeError(err)}` })
        }
        this.emit({ done: i + 1 })
        await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_MS))
      }
      this.emit({ state: 'idle', message: `已完成 ${todo.length} 張` })
    } finally {
      this.running = null
    }
  }
}
