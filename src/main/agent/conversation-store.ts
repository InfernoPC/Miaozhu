import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, ConversationSummary } from '@shared/types'
import type { LLMMessage } from '../providers/types'
import { readJson, removeFile, writeJson } from '../util/json-file'

const VERSION = 1
/** Bounds on what's kept on disk, so a long-running chat can't grow its file without limit. */
const MAX_DISPLAY_MESSAGES = 200
const MAX_TURNS = 40
const TITLE_CHARS = 28

export interface SavedConversation {
  history: ChatMessage[]
  turns: LLMMessage[][]
}

interface ConversationFile extends SavedConversation {
  version: number
  id: string
  title: string
  /** True once the user renamed it; automatic titles no longer apply. */
  customTitle?: boolean
  createdAt: string
  updatedAt: string
}

interface IndexFile {
  current?: string
}

const dir = () => join(app.getPath('userData'), 'conversations')
const fileOf = (id: string) => join(dir(), `${id}.json`)
const indexPath = () => join(dir(), 'index.json')
/** Before M4.2 there was a single conversation file. */
const legacyPath = () => join(app.getPath('userData'), 'conversation.json')

/** Images are large base64 blobs; the saved copy keeps a note of where they were instead. */
function withoutImages(turns: LLMMessage[][]): LLMMessage[][] {
  return turns.map((turn) =>
    turn.map((m) =>
      m.role === 'user' && m.content.some((c) => c.type === 'image')
        ? { ...m, content: m.content.map((c) => (c.type === 'image' ? { type: 'text' as const, text: '[圖片已省略]' } : c)) }
        : m
    )
  )
}

/** A title from the first thing the user said (or the files they dropped). */
export function titleFor(history: ChatMessage[]): string {
  const first = history.find((m) => m.role === 'user')
  if (!first) return '新對話'
  const text = first.text.replace(/\s+/g, ' ').trim() || first.attachments?.map((a) => a.name).join('、') || '新對話'
  return text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS)}…` : text
}

const isId = (id: string) => /^[a-zA-Z0-9-]{1,64}$/.test(id)

/**
 * Saved conversations, one file each, plus which one is open. Permission grants ("allow for
 * this conversation") are deliberately not saved: reopening a conversation asks again.
 */
export class ConversationStore {
  constructor() {
    mkdirSync(dir(), { recursive: true })
    this.migrateLegacy()
  }

  private migrateLegacy(): void {
    const legacy = readJson<(SavedConversation & { version: number; savedAt?: string }) | null>(legacyPath(), null)
    if (!legacy) return
    if (Array.isArray(legacy.history) && legacy.history.length) {
      const id = randomUUID()
      const at = legacy.savedAt ?? new Date().toISOString()
      this.write({ version: VERSION, id, title: titleFor(legacy.history), createdAt: at, updatedAt: at, history: legacy.history, turns: legacy.turns ?? [] })
      this.setCurrent(id)
    }
    removeFile(legacyPath())
  }

  private read(id: string): ConversationFile | null {
    if (!isId(id)) return null
    const f = readJson<ConversationFile | null>(fileOf(id), null)
    return f && f.version === VERSION && Array.isArray(f.history) && Array.isArray(f.turns) ? f : null
  }

  private write(f: ConversationFile): void {
    try {
      writeJson(fileOf(f.id), f)
    } catch {
      // Saving is best-effort: a full disk must not break the conversation itself.
    }
  }

  list(): ConversationSummary[] {
    return readdirSync(dir())
      .filter((n) => n.endsWith('.json') && n !== 'index.json')
      .map((n) => this.read(n.slice(0, -5)))
      .filter((f): f is ConversationFile => !!f)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((f) => ({ id: f.id, title: f.title, updatedAt: f.updatedAt, messageCount: f.history.length }))
  }

  load(id: string): SavedConversation | null {
    const f = this.read(id)
    return f ? { history: f.history, turns: f.turns } : null
  }

  current(): string | undefined {
    const id = readJson<IndexFile>(indexPath(), {}).current
    return id && existsSync(fileOf(id)) ? id : undefined
  }

  setCurrent(id: string | undefined): void {
    writeJson(indexPath(), { current: id })
  }

  save(id: string, { history, turns }: SavedConversation): void {
    if (!isId(id) || !history.length) return
    const existing = this.read(id)
    const now = new Date().toISOString()
    this.write({
      version: VERSION,
      id,
      title: existing?.customTitle ? existing.title : titleFor(history),
      customTitle: existing?.customTitle,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      history: history.slice(-MAX_DISPLAY_MESSAGES),
      turns: withoutImages(turns.slice(-MAX_TURNS))
    })
    this.setCurrent(id)
  }

  rename(id: string, title: string): void {
    const f = this.read(id)
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!f || !clean) return
    this.write({ ...f, title: clean, customTitle: true })
  }

  remove(id: string): void {
    if (!isId(id)) return
    removeFile(fileOf(id))
    if (this.current() === id) this.setCurrent(undefined)
  }
}
