import { app } from 'electron'
import { join } from 'node:path'
import type { ChatMessage } from '@shared/types'
import type { LLMMessage } from '../providers/types'
import { readJson, removeFile, writeJson } from '../util/json-file'

const VERSION = 1
/** Bounds on what's kept on disk, so a long-running chat can't grow the file without limit. */
const MAX_DISPLAY_MESSAGES = 200
const MAX_TURNS = 40

export interface SavedConversation {
  history: ChatMessage[]
  turns: LLMMessage[][]
}

interface FileShape extends SavedConversation {
  version: number
  savedAt: string
}

const filePath = () => join(app.getPath('userData'), 'conversation.json')

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

/**
 * The current conversation, saved after every turn so it survives a restart. Permission grants
 * ("allow for this conversation") are deliberately not saved: a restart starts from asking again.
 */
export class ConversationStore {
  load(): SavedConversation | null {
    const data = readJson<FileShape | null>(filePath(), null)
    if (!data || data.version !== VERSION || !Array.isArray(data.history) || !Array.isArray(data.turns)) return null
    return { history: data.history, turns: data.turns }
  }

  save({ history, turns }: SavedConversation): void {
    const data: FileShape = {
      version: VERSION,
      savedAt: new Date().toISOString(),
      history: history.slice(-MAX_DISPLAY_MESSAGES),
      turns: withoutImages(turns.slice(-MAX_TURNS))
    }
    try {
      writeJson(filePath(), data)
    } catch {
      // Saving is best-effort: a full disk must not break the conversation itself.
    }
  }

  clear(): void {
    removeFile(filePath())
  }
}
