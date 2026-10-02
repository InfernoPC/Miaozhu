import { shell } from 'electron'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type { GalleryFolderView, GalleryImageView, GalleryListing } from '@shared/types'
import { isInside } from '../tools/paths'

export const GALLERY_EXTS = new Set(['.png', '.apng', '.gif', '.jpg', '.jpeg', '.webp'])
/** The gallery's own data (tag index) lives here, hidden from the listing. */
export const DATA_DIR = '.miaozhu'

export const isGalleryImage = (name: string) => GALLERY_EXTS.has(extname(name).toLowerCase())
const hidden = (name: string) => name.startsWith('.')
/** Always "/" in what the UI and the tag index see, on every OS. */
const toRel = (root: string, abs: string) => relative(root, abs).split(sep).join('/')

/** GIF, or a PNG with an animation chunk (APNG). */
export function isAnimated(abs: string): boolean {
  const ext = extname(abs).toLowerCase()
  if (ext === '.gif') return true
  if (ext !== '.png' && ext !== '.apng') return false
  try {
    // acTL comes before the first IDAT; the first few KB are enough.
    const fd = openSync(abs, 'r')
    try {
      const buf = Buffer.alloc(4096)
      const n = readSync(fd, buf, 0, buf.length, 0)
      return buf.subarray(0, n).includes('acTL')
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

/** A name for a new file or folder: no path separators or reserved characters. */
function cleanName(name: string): string {
  const n = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  if (!n || n === '.' || n === '..' || hidden(n)) throw new Error('名稱不能是空的，也不能用 . 開頭')
  return n.slice(0, 200)
}

/** "name.png" → "name (2).png" until it's free. */
function freePath(dir: string, name: string): string {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  let p = join(dir, name)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base} (${i})${ext}`)
  return p
}

/**
 * The meme gallery: a folder of images the user organizes. Every path from the UI is
 * relative to the root and resolved here, and nothing outside the root is ever touched.
 */
export class GalleryLibrary {
  constructor(private rootPath: () => string) {}

  root(): string {
    const r = this.rootPath()
    mkdirSync(r, { recursive: true })
    return r
  }

  /** rel → absolute path, refusing anything that ends up outside the root (../, links). */
  resolve(rel: string): string {
    const root = this.root()
    const parts = rel.split(/[\\/]+/).filter(Boolean)
    if (parts.some((p) => p === '..' || hidden(p))) throw new Error('不在梗圖庫裡')
    const abs = join(root, ...parts)
    let real = abs
    try {
      real = realpathSync.native(abs)
    } catch {
      real = join(realpathSync.native(dirname(abs)), basename(abs))
    }
    if (!isInside(real, realpathSync.native(root))) throw new Error('不在梗圖庫裡')
    return abs
  }

  list(rel = ''): GalleryListing {
    const root = this.root()
    const dir = this.resolve(rel)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('找不到這個資料夾')
    const folders: GalleryFolderView[] = []
    const images: GalleryImageView[] = []
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))) {
      if (hidden(e.name)) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        let inside: string[] = []
        try {
          inside = readdirSync(abs).filter((n) => !hidden(n) && isGalleryImage(n)).sort()
        } catch {
          // Unreadable folder: still listed, just without a cover.
        }
        folders.push({ name: e.name, rel: toRel(root, abs), cover: inside[0] ? toRel(root, join(abs, inside[0])) : undefined, imageCount: inside.length })
      } else if (e.isFile() && isGalleryImage(e.name)) {
        images.push(this.imageView(root, abs))
      }
    }
    return { root, rel: toRel(root, dir), folders, images }
  }

  private imageView(root: string, abs: string): GalleryImageView {
    const st = statSync(abs)
    return { name: basename(abs), rel: toRel(root, abs), size: st.size, mtime: Math.round(st.mtimeMs), animated: isAnimated(abs) }
  }

  /** Every image in the gallery, for search and tagging. */
  allImages(): GalleryImageView[] {
    const root = this.root()
    const out: GalleryImageView[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 12) return
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (hidden(e.name)) continue
        const abs = join(dir, e.name)
        if (e.isDirectory()) walk(abs, depth + 1)
        else if (e.isFile() && isGalleryImage(e.name)) out.push(this.imageView(root, abs))
      }
    }
    walk(root, 0)
    return out
  }

  /** All folders, for "move to…". */
  allFolders(): string[] {
    const root = this.root()
    const out: string[] = ['']
    const walk = (dir: string, depth: number) => {
      if (depth > 6) return
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || hidden(e.name)) continue
        const abs = join(dir, e.name)
        out.push(toRel(root, abs))
        walk(abs, depth + 1)
      }
    }
    walk(root, 0)
    return out
  }

  mkdir(parentRel: string, name: string): string {
    const dir = join(this.resolve(parentRel), cleanName(name))
    if (existsSync(dir)) throw new Error('已經有同名的資料夾')
    mkdirSync(dir)
    return toRel(this.root(), dir)
  }

  rename(rel: string, name: string): string {
    const abs = this.resolve(rel)
    if (!rel) throw new Error('不能重新命名梗圖庫本身')
    let next = cleanName(name)
    // Keep the extension unless an image one was typed (so the file stays an image).
    if (statSync(abs).isFile() && !isGalleryImage(next)) next += extname(abs)
    const target = join(dirname(abs), next)
    if (target === abs) return rel
    if (existsSync(target)) throw new Error(`已經有「${next}」了`)
    renameSync(abs, target)
    return toRel(this.root(), target)
  }

  move(rel: string, toFolderRel: string): string {
    const abs = this.resolve(rel)
    const dest = this.resolve(toFolderRel)
    if (!rel) throw new Error('不能搬移梗圖庫本身')
    if (statSync(abs).isDirectory() && isInside(dest, abs)) throw new Error('不能搬到自己或自己的子資料夾裡')
    if (dirname(abs) === dest) return rel
    const target = join(dest, basename(abs))
    if (existsSync(target)) throw new Error(`「${toFolderRel || '梗圖庫'}」裡已經有「${basename(abs)}」了`)
    renameSync(abs, target)
    return toRel(this.root(), target)
  }

  /** To the Trash / Recycle Bin, never deleted outright. */
  async remove(rel: string): Promise<void> {
    if (!rel) throw new Error('不能刪除梗圖庫本身')
    await shell.trashItem(this.resolve(rel))
  }

  /** Copies image files (e.g. dropped from Finder) into a folder; returns how many. */
  importFiles(paths: string[], toFolderRel: string): number {
    const dest = this.resolve(toFolderRel)
    let n = 0
    for (const p of paths) {
      if (!isGalleryImage(p) || !existsSync(p) || !statSync(p).isFile()) continue
      if (dirname(p) === dest) continue
      copyFileSync(p, freePath(dest, basename(p)))
      n++
    }
    return n
  }

  /** Saves image bytes (e.g. from the clipboard) into a folder. */
  saveImage(bytes: Buffer, ext: string, toFolderRel: string): string {
    const d = new Date()
    const p2 = (n: number) => String(n).padStart(2, '0')
    const name = `貼上 ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}${ext}`
    const target = freePath(this.resolve(toFolderRel), name)
    writeFileSync(target, bytes)
    return toRel(this.root(), target)
  }
}
