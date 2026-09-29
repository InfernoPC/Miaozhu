import { nativeImage, shell } from 'electron'
import { appendFile, cp, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { displayPath, expandPath } from './paths'
import { ToolError, type ToolDef, type ToolResult } from './types'

const MAX_TEXT_CHARS = 60_000
const MAX_IMAGE_SIDE = 1568
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const UNSUPPORTED_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.zip', '.dmg', '.exe'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'Library', 'AppData', '$Recycle.Bin', '.Trash', 'System Volume Information'])

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

const formatTime = (d: Date) =>
  d.toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export const isImagePath = (p: string) => IMAGE_EXTS.has(extname(p).toLowerCase())

/** Downscales large images so they stay within model limits and don't burn tokens. */
export function imageToDataUrl(img: Electron.NativeImage): string {
  const { width, height } = img.getSize()
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height))
  const sized = scale < 1 ? img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : img
  return `data:image/jpeg;base64,${sized.toJPEG(80).toString('base64')}`
}

async function looksBinary(abs: string): Promise<boolean> {
  const fh = await open(abs, 'r')
  try {
    const buf = Buffer.alloc(8192)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}

export type FileContent = { kind: 'text'; text: string; note: string } | { kind: 'image'; dataUrl: string; note: string }

/** Reads a file in the form a model can use: text (incl. PDF text) or a downscaled image. */
export async function readForModel(abs: string, maxChars = MAX_TEXT_CHARS): Promise<FileContent> {
  const info = await stat(abs).catch(() => null)
  if (!info) throw new ToolError(`找不到檔案：${displayPath(abs)}`)
  if (info.isDirectory()) throw new ToolError(`${displayPath(abs)} 是資料夾，請改用 list_dir`)
  const ext = extname(abs).toLowerCase()

  if (IMAGE_EXTS.has(ext)) {
    const img = nativeImage.createFromPath(abs)
    if (img.isEmpty()) throw new ToolError(`無法讀取圖片：${displayPath(abs)}`)
    const { width, height } = img.getSize()
    return { kind: 'image', dataUrl: imageToDataUrl(img), note: `圖片 ${width}×${height}` }
  }

  let text: string
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(abs)))
    const { text: pages, totalPages } = await extractText(pdf, { mergePages: false })
    text = pages.map((t, i) => `--- 第 ${i + 1} 頁 ---\n${t}`).join('\n\n')
    if (!text.replace(/--- 第 \d+ 頁 ---/g, '').trim()) {
      throw new ToolError(`這份 PDF（${totalPages} 頁）沒有可擷取的文字，可能是掃描檔`)
    }
  } else if (UNSUPPORTED_EXTS.has(ext)) {
    throw new ToolError(`目前還不支援讀取 ${ext} 檔案內容`)
  } else {
    if (await looksBinary(abs)) throw new ToolError(`${displayPath(abs)} 看起來是二進位檔，無法以文字讀取`)
    text = await readFile(abs, 'utf8')
  }

  const truncated = text.length > maxChars
  return {
    kind: 'text',
    text: truncated ? text.slice(0, maxChars) : text,
    note: truncated ? `共 ${text.length} 字，只讀取前 ${maxChars} 字` : `${text.length} 字`
  }
}

// ── list_dir ────────────────────────────────────────────────────────────────

const listDir: ToolDef = {
  spec: {
    name: 'list_dir',
    description: '列出資料夾內容（檔名、大小、修改時間）。depth 可設 1–3 以列出子資料夾。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '資料夾路徑，可用 ~ 代表家目錄，例如 ~/Downloads' },
        depth: { type: 'integer', description: '要列出的層數，預設 1，最多 3' },
        show_hidden: { type: 'boolean', description: '是否包含 . 開頭的隱藏檔，預設 false' }
      },
      required: ['path']
    }
  },
  risk: 'read',
  title: (i) => `列出 ${displayPath(expandPath(str(i.path)))}`,
  paths: (i) => [{ path: expandPath(str(i.path)), access: 'read' }],
  async run(i, ctx) {
    const root = expandPath(str(i.path))
    const depth = Math.min(3, Math.max(1, Number(i.depth) || 1))
    const lines: string[] = []
    const LIMIT = 400
    let count = 0

    const walk = async (dir: string, level: number, indent: string) => {
      const entries = await readdir(dir, { withFileTypes: true }).catch((e) => {
        throw new ToolError(`無法讀取資料夾 ${displayPath(dir)}：${(e as Error).message}`)
      })
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      for (const e of entries) {
        if (count >= LIMIT) return
        if (!i.show_hidden && e.name.startsWith('.')) continue
        const abs = join(dir, e.name)
        if (ctx.isBlocked(abs)) continue
        count++
        if (e.isDirectory()) {
          lines.push(`${indent}📁 ${e.name}/`)
          if (level < depth) await walk(abs, level + 1, indent + '  ')
        } else {
          const s = await stat(abs).catch(() => null)
          lines.push(`${indent}📄 ${e.name}${s ? `  (${formatSize(s.size)}, ${formatTime(s.mtime)})` : ''}`)
        }
      }
    }
    await walk(root, 1, '')
    if (count >= LIMIT) lines.push(`…（超過 ${LIMIT} 項，已截斷）`)
    return {
      text: `${displayPath(root)}：\n${lines.join('\n') || '（空資料夾）'}`,
      summary: `${count} 個項目`
    }
  }
}

// ── read_file ───────────────────────────────────────────────────────────────

const readFileTool: ToolDef = {
  spec: {
    name: 'read_file',
    description: '讀取檔案內容。支援文字檔、程式碼、CSV、PDF（擷取文字）與圖片（會讓你看到圖片）。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '檔案路徑，可用 ~ 代表家目錄' } },
      required: ['path']
    }
  },
  risk: 'read',
  title: (i) => `讀取 ${displayPath(expandPath(str(i.path)))}`,
  paths: (i) => [{ path: expandPath(str(i.path)), access: 'read' }],
  async run(i) {
    const abs = expandPath(str(i.path))
    const content = await readForModel(abs)
    if (content.kind === 'image') {
      return { text: `已載入圖片 ${displayPath(abs)}（${content.note}），圖片內容附在下一則訊息。`, summary: content.note, images: [content.dataUrl] }
    }
    return { text: `${displayPath(abs)}（${content.note}）：\n\n${content.text}`, summary: content.note }
  }
}

// ── search_files ────────────────────────────────────────────────────────────

function globToRegExp(pattern: string): RegExp {
  if (!/[*?]/.test(pattern)) return new RegExp(pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i')
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${re}$`, 'i')
}

const searchFiles: ToolDef = {
  spec: {
    name: 'search_files',
    description:
      '在資料夾（含子資料夾）中搜尋檔案。name 比對檔名（支援 * 與 ?，例如 *.pdf；不含萬用字元時為部分比對），contains 搜尋文字檔內容。兩者至少填一個。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要搜尋的資料夾，例如 ~/Documents' },
        name: { type: 'string', description: '檔名條件，例如 *.xlsx 或 報價' },
        contains: { type: 'string', description: '檔案內容需包含的文字（不分大小寫）' },
        max_results: { type: 'integer', description: '最多回傳幾筆，預設 50' }
      },
      required: ['path']
    }
  },
  risk: 'read',
  title: (i) => `在 ${displayPath(expandPath(str(i.path)))} 搜尋 ${[str(i.name), str(i.contains) && `「${str(i.contains)}」`].filter(Boolean).join(' ')}`,
  paths: (i) => [{ path: expandPath(str(i.path)), access: 'read' }],
  async run(i, ctx) {
    const root = expandPath(str(i.path))
    const name = str(i.name)
    const contains = str(i.contains).toLowerCase()
    if (!name && !contains) throw new ToolError('name 與 contains 至少要填一個')
    const nameRe = name ? globToRegExp(name) : null
    const max = Math.min(200, Math.max(1, Number(i.max_results) || 50))
    const MAX_SCANNED = 20_000

    const results: string[] = []
    let scanned = 0
    const queue = [root]
    while (queue.length && results.length < max && scanned < MAX_SCANNED) {
      if (ctx.signal.aborted) throw new ToolError('已取消')
      const dir = queue.shift()!
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (results.length >= max || ++scanned > MAX_SCANNED) break
        const abs = join(dir, e.name)
        if (e.name.startsWith('.') || ctx.isBlocked(abs)) continue
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) queue.push(abs)
          continue
        }
        // Symlinks are never followed: a link could point into a protected location.
        if (!e.isFile()) continue
        if (nameRe && !nameRe.test(e.name)) continue
        if (!contains) {
          results.push(displayPath(abs))
          continue
        }
        const s = await stat(abs).catch(() => null)
        if (!s || s.size > 2 * 1024 ** 2 || IMAGE_EXTS.has(extname(e.name).toLowerCase())) continue
        if (await looksBinary(abs).catch(() => true)) continue
        const lines = (await readFile(abs, 'utf8')).split(/\r?\n/)
        const hits = lines.flatMap((l, n) => (l.toLowerCase().includes(contains) ? [`  ${n + 1}: ${l.trim().slice(0, 160)}`] : []))
        if (hits.length) results.push(`${displayPath(abs)}\n${hits.slice(0, 3).join('\n')}${hits.length > 3 ? `\n  …共 ${hits.length} 處` : ''}`)
      }
    }
    const capped = scanned >= MAX_SCANNED ? `\n（已掃描 ${MAX_SCANNED} 個項目上限，結果可能不完整）` : ''
    return {
      text: results.length ? `找到 ${results.length} 筆：\n${results.join('\n')}${capped}` : `沒有找到符合的檔案${capped}`,
      summary: `找到 ${results.length} 筆`
    }
  }
}

// ── write_file ──────────────────────────────────────────────────────────────

const writeFileTool: ToolDef = {
  spec: {
    name: 'write_file',
    description: '建立或覆寫文字檔（會自動建立上層資料夾）。mode 為 append 時接在檔案最後。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '檔案路徑' },
        content: { type: 'string', description: '要寫入的完整內容' },
        mode: { type: 'string', enum: ['overwrite', 'append'], description: '預設 overwrite' }
      },
      required: ['path', 'content']
    }
  },
  risk: 'write',
  title: (i) => `${i.mode === 'append' ? '附加到' : '寫入'} ${displayPath(expandPath(str(i.path)))}`,
  paths: (i) => [{ path: expandPath(str(i.path)), access: 'write' }],
  async detail(i) {
    const abs = expandPath(str(i.path))
    const existing = await stat(abs).catch(() => null)
    const content = str(i.content)
    const preview = content.length > 1500 ? content.slice(0, 1500) + `\n…（共 ${content.length} 字）` : content
    const action = existing ? (i.mode === 'append' ? `附加到現有檔案（${formatSize(existing.size)}）` : `⚠️ 覆寫現有檔案（${formatSize(existing.size)}）`) : '建立新檔案'
    return `${displayPath(abs)}\n${action}\n\n${preview}`
  },
  async run(i) {
    const abs = expandPath(str(i.path))
    await mkdir(dirname(abs), { recursive: true })
    const content = str(i.content)
    if (i.mode === 'append') await appendFile(abs, content, 'utf8')
    else await writeFile(abs, content, 'utf8')
    return { text: `已寫入 ${displayPath(abs)}（${content.length} 字）`, summary: `已寫入 ${content.length} 字` }
  }
}

// ── move_file ───────────────────────────────────────────────────────────────

const moveFile: ToolDef = {
  spec: {
    name: 'move_file',
    description: '移動或重新命名檔案／資料夾。destination 若是既有資料夾，會移到該資料夾內。不會覆蓋已存在的檔案。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '原本的路徑' },
        destination: { type: 'string', description: '新路徑或目標資料夾' }
      },
      required: ['source', 'destination']
    }
  },
  risk: 'write',
  title: (i) => `移動 ${displayPath(expandPath(str(i.source)))} → ${displayPath(expandPath(str(i.destination)))}`,
  paths: (i) => [
    { path: expandPath(str(i.source)), access: 'write' },
    { path: expandPath(str(i.destination)), access: 'write' }
  ],
  async run(i) {
    const src = expandPath(str(i.source))
    let dest = expandPath(str(i.destination))
    if (!(await stat(src).catch(() => null))) throw new ToolError(`找不到 ${displayPath(src)}`)
    const destInfo = await stat(dest).catch(() => null)
    if (destInfo?.isDirectory()) dest = join(dest, basename(src))
    if (await stat(dest).catch(() => null)) throw new ToolError(`${displayPath(dest)} 已存在，為避免覆蓋已停止`)
    await mkdir(dirname(dest), { recursive: true })
    try {
      await rename(src, dest)
    } catch (e) {
      // Different volume (e.g. external drive): copy then delete.
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
      await cp(src, dest, { recursive: true, errorOnExist: true, force: false })
      await rm(src, { recursive: true })
    }
    return { text: `已移動到 ${displayPath(dest)}`, summary: `→ ${displayPath(dest)}` }
  }
}

// ── create_folder ───────────────────────────────────────────────────────────

const createFolder: ToolDef = {
  spec: {
    name: 'create_folder',
    description: '建立資料夾（含所有上層資料夾）。',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '資料夾路徑' } }, required: ['path'] }
  },
  risk: 'write',
  title: (i) => `建立資料夾 ${displayPath(expandPath(str(i.path)))}`,
  paths: (i) => [{ path: expandPath(str(i.path)), access: 'write' }],
  async run(i) {
    const abs = expandPath(str(i.path))
    await mkdir(abs, { recursive: true })
    return { text: `已建立 ${displayPath(abs)}`, summary: '已建立' }
  }
}

// ── delete_file ─────────────────────────────────────────────────────────────

const deleteFile: ToolDef = {
  spec: {
    name: 'delete_file',
    description: '刪除檔案或資料夾：一律移到垃圾桶（資源回收筒），使用者可以自行還原。',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '要刪除的路徑' } }, required: ['path'] }
  },
  risk: 'write',
  title: (i) => `刪除 ${displayPath(expandPath(str(i.path)))}（移到垃圾桶）`,
  paths: (i) => [{ path: expandPath(str(i.path)), access: 'write' }],
  async detail(i) {
    const abs = expandPath(str(i.path))
    const s = await stat(abs).catch(() => null)
    if (!s) return `${displayPath(abs)}\n（找不到這個路徑）`
    if (!s.isDirectory()) return `${displayPath(abs)}\n檔案，${formatSize(s.size)}`
    const n = (await readdir(abs).catch(() => [])).length
    return `${displayPath(abs)}\n⚠️ 整個資料夾（第一層有 ${n} 個項目）`
  },
  async run(i) {
    const abs = expandPath(str(i.path))
    if (!(await stat(abs).catch(() => null))) throw new ToolError(`找不到 ${displayPath(abs)}`)
    await shell.trashItem(abs)
    return { text: `已將 ${displayPath(abs)} 移到垃圾桶`, summary: '已移到垃圾桶' }
  }
}

export const fsTools: ToolDef[] = [listDir, readFileTool, searchFiles, writeFileTool, moveFile, createFolder, deleteFile]

export type { ToolResult }
