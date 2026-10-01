import { useEffect, useState } from 'react'
import type { ConversationSummary } from '@shared/types'
import { Icon } from '../common/Icon'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return '剛剛'
  if (min < 60) return `${min} 分鐘前`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} 小時前`
  const d = new Date(iso)
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

/** Past conversations: open, rename, delete. Opens over the chat from the left. */
export function ConversationDrawer({ currentId, onClose }: { currentId: string; onClose: () => void }) {
  const [list, setList] = useState<ConversationSummary[]>([])
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    void window.api.conversations.list().then(setList)
  }, [currentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" aria-label="對話紀錄">
        <div className="drawer-head">
          <h2>對話紀錄</h2>
          <button className="quiet" aria-label="關閉" onClick={onClose}>
            <Icon name="cross" size={15} />
          </button>
        </div>
        <ul className="conv-list">
          {list.map((c) => (
            <li key={c.id} className={c.id === currentId ? 'current' : ''}>
              {editing?.id === c.id ? (
                <form
                  className="conv-edit"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    setList(await window.api.conversations.rename(c.id, editing.title))
                    setEditing(null)
                  }}
                >
                  <input autoFocus value={editing.title} aria-label="對話名稱" onChange={(e) => setEditing({ id: c.id, title: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                  <button type="submit" className="quiet">
                    <Icon name="check" size={14} />
                  </button>
                </form>
              ) : confirmDelete === c.id ? (
                <div className="conv-confirm">
                  <span>刪除「{c.title}」？</span>
                  <button className="danger" onClick={async () => (setList(await window.api.conversations.remove(c.id)), setConfirmDelete(null))}>
                    刪除
                  </button>
                  <button className="quiet" onClick={() => setConfirmDelete(null)}>
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className="conv-open"
                    onClick={async () => {
                      await window.api.conversations.open(c.id)
                      onClose()
                    }}
                  >
                    <span className="conv-title">{c.title}</span>
                    <span className="conv-meta">{relativeTime(c.updatedAt)}</span>
                  </button>
                  <div className="conv-actions">
                    <button className="quiet" aria-label={`重新命名「${c.title}」`} onClick={() => setEditing({ id: c.id, title: c.title })}>
                      重新命名
                    </button>
                    <button className="quiet" aria-label={`刪除「${c.title}」`} onClick={() => setConfirmDelete(c.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          {list.length === 0 && <li className="hint conv-empty">還沒有其他對話。</li>}
        </ul>
      </aside>
    </>
  )
}
