import { useEffect, useRef, useState } from 'react'
import type { AttachmentView, ChatMessage, MessagePart, PermissionRequest } from '@shared/types'
import { AttachmentChips, droppedPaths } from '../common/AttachmentChips'
import { CatMark, Icon } from '../common/Icon'
import { Markdown } from '../common/Markdown'
import { PermissionPrompt } from '../common/PermissionPrompt'
import { groupParts, ToolLog } from '../common/ToolCard'
import { DeskCat } from '../pet/DeskCat'
import { ConversationDrawer } from './ConversationDrawer'
import './chat.css'

/** Starting points that show what the cat can actually do. */
const SUGGESTIONS = ['整理我的下載資料夾', '桌面上有哪些 PDF？幫我列出來', '今天台北天氣如何？']

/** Mirrors Agent.appendText / updateTool so streamed parts render in the order they happened. */
function applyDelta(parts: MessagePart[], text: string): MessagePart[] {
  const last = parts[parts.length - 1]
  if (last?.type === 'text') return [...parts.slice(0, -1), { type: 'text', text: last.text + text }]
  return [...parts, { type: 'text', text }]
}

function applyTool(parts: MessagePart[], tool: Extract<MessagePart, { type: 'tool' }>['tool']): MessagePart[] {
  const i = parts.findIndex((p) => p.type === 'tool' && p.tool.id === tool.id)
  if (i < 0) return [...parts, { type: 'tool', tool }]
  return parts.map((p, n) => (n === i ? { type: 'tool', tool } : p))
}

function MessageBody({ m, streaming }: { m: ChatMessage; streaming: boolean }) {
  if (m.role === 'user') {
    return (
      <>
        {m.attachments && <AttachmentChips items={m.attachments} />}
        {m.text && <div className="msg-text">{m.text}</div>}
      </>
    )
  }
  const parts = m.parts?.length ? m.parts : m.text ? [{ type: 'text' as const, text: m.text }] : []
  if (!parts.length) return streaming ? <div className="msg-text typing">想一下…</div> : null
  return (
    <div className="msg-text">
      {groupParts(parts).map((g) => (g.type === 'text' ? <Markdown key={g.key} text={g.text} /> : <ToolLog key={g.key} tools={g.tools} />))}
    </div>
  )
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<AttachmentView[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [conversationId, setConversationId] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.agent.history().then(setMessages)
    void window.api.agent.pendingPermissions().then(setPermissions)
    void window.api.conversations.current().then(setConversationId)
    const update = (id: string, fn: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)))
    return window.api.agent.onEvent((e) => {
      if (e.type === 'turn-start') {
        setStreamingId(e.assistantId)
        setMessages((ms) => [...ms, e.userMessage, { id: e.assistantId, role: 'assistant', text: '', parts: [], createdAt: Date.now() }])
      } else if (e.type === 'delta') {
        update(e.assistantId, (m) => ({ ...m, text: m.text + e.text, parts: applyDelta(m.parts ?? [], e.text) }))
      } else if (e.type === 'tool') {
        update(e.assistantId, (m) => ({ ...m, parts: applyTool(m.parts ?? [], e.tool) }))
      } else if (e.type === 'turn-end') {
        setStreamingId(null)
        update(e.message.id, () => e.message)
      } else if (e.type === 'permission-request') {
        setPermissions((ps) => [...ps, e.request])
      } else if (e.type === 'permission-resolved') {
        setPermissions((ps) => ps.filter((p) => p.id !== e.id))
      } else if (e.type === 'history-cleared' || e.type === 'conversation-changed') {
        setStreamingId(null)
        setPermissions([])
        if (e.type === 'conversation-changed') setConversationId(e.id)
        void window.api.agent.history().then(setMessages)
      }
    })
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, permissions])

  const submit = (override?: string) => {
    const text = (override ?? draft).trim()
    if (!text && !attachments.length) return
    const paths = attachments.map((a) => a.path)
    setDraft('')
    setAttachments([])
    void window.api.agent.send(text, paths)
  }

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault()
    setDragOver(false)
    const paths = droppedPaths(ev)
    if (!paths.length) return
    const views = await window.api.agent.describeAttachments(paths)
    setAttachments((prev) => [...prev, ...views.filter((v) => !prev.some((p) => p.path === v.path))])
  }

  return (
    <div
      className={`chat ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(ev) => {
        ev.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(ev) => {
        if (ev.currentTarget === ev.target) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <header className="chat-header">
        <div className="chat-title-row">
          <button className="quiet drawer-toggle" aria-label="對話紀錄" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" size={17} />
          </button>
          <h1 className="chat-title">
            <CatMark />
            喵助
          </h1>
        </div>
        <div className="chat-header-actions">
          <button className="quiet" onClick={() => window.api.conversations.create()} disabled={messages.length === 0} title="開始新對話，目前的對話會留在對話紀錄裡">
            <Icon name="plus" size={15} />
            新對話
          </button>
          <button className="quiet" onClick={() => window.api.windows.openSettings()}>
            <Icon name="gear" size={15} />
            設定
          </button>
        </div>
      </header>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-cat">
              <DeskCat state="idle" />
            </div>
            <p className="chat-empty-title">有什麼要我幫忙的？</p>
            <p className="chat-hint">我可以整理資料夾、讀 PDF、上網查資料、看螢幕。也可以直接把檔案拖進來。</p>
            <div className="suggestions">
              {SUGGESTIONS.map((q) => (
                <button key={q} onClick={() => submit(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            {m.role === 'assistant' && <CatMark size={20} />}
            <div className="msg-body">
              <MessageBody m={m} streaming={m.id === streamingId} />
              {m.error && (
                <div className="msg-error">
                  <Icon name="alert" size={14} />
                  <span>{m.error}</span>
                </div>
              )}
              {m.model && <div className="msg-meta">{m.model}</div>}
            </div>
          </div>
        ))}
        {permissions.map((p) => (
          <div key={p.id} className="msg msg-assistant">
            <CatMark size={20} />
            <div className="msg-body perm-balloon">
              <PermissionPrompt request={p} />
            </div>
          </div>
        ))}
      </div>

      <form
        className="chat-input"
        onSubmit={(ev) => {
          ev.preventDefault()
          submit()
        }}
      >
        {attachments.length > 0 && (
          <AttachmentChips items={attachments} onRemove={(p) => setAttachments((as) => as.filter((a) => a.path !== p))} />
        )}
        <div className="chat-input-row">
          <textarea
            value={draft}
            rows={2}
            placeholder="輸入訊息，Enter 送出，Shift+Enter 換行"
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              // isComposing: don't send while an IME (注音 / 倉頡) is still composing.
              if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault()
                submit()
              }
            }}
          />
          {streamingId ? (
            <button type="button" onClick={() => window.api.agent.cancel()}>
              停下來
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!draft.trim() && !attachments.length}>
              送出
            </button>
          )}
        </div>
      </form>
      {drawer && <ConversationDrawer currentId={conversationId} onClose={() => setDrawer(false)} />}
      {dragOver && <div className="drop-overlay">放開，把檔案交給喵助</div>}
    </div>
  )
}
