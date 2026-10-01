import { useEffect, useState } from 'react'
import type { DndView, ReminderRepeat, ReminderView } from '@shared/types'
import { Icon } from '../common/Icon'

const REPEAT_LABEL: Record<ReminderRepeat, string> = { none: '一次', daily: '每天', weekdays: '每個工作日', weekly: '每週', monthly: '每月' }
const when = (iso: string) =>
  new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

export function RemindersTab() {
  const [list, setList] = useState<ReminderView[]>([])
  const [dnd, setDnd] = useState<DndView | null>(null)
  const [quiet, setQuiet] = useState({ start: '', end: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const refresh = () => {
      void window.api.reminders.list().then(setList)
      void window.api.reminders.dnd().then((d) => {
        setDnd(d)
        setQuiet({ start: d.quietStart ?? '', end: d.quietEnd ?? '' })
      })
    }
    refresh()
    // Reminders are mostly created in chat; keep the list current while this tab is open.
    const timer = setInterval(() => void window.api.reminders.list().then(setList), 5000)
    return () => clearInterval(timer)
  }, [])
  if (!dnd) return null

  const until = dnd.until && new Date(dnd.until) > new Date() ? new Date(dnd.until) : null

  return (
    <div className="settings-page">
      <section>
        <h2>即將到來的提醒</h2>
        <p className="hint">跟喵助說「3 點提醒我開會」或「每個工作日 9 點提醒我打卡」就會出現在這裡。</p>
        <ul className="folder-list">
          {list.map((r) => (
            <li key={r.id}>
              <span className="folder-path reminder-row">
                <strong>{when(r.at)}</strong>
                <span>{r.text}</span>
                {r.repeat !== 'none' && <span className="muted">{REPEAT_LABEL[r.repeat]}</span>}
              </span>
              <button className="quiet" aria-label={`取消「${r.text}」`} onClick={async () => setList(await window.api.reminders.cancel(r.id))}>
                <Icon name="cross" size={14} />
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="hint">目前沒有提醒。</li>}
        </ul>
      </section>

      <section>
        <h2>勿擾</h2>
        <p className="hint">勿擾期間提醒會先保留，結束後再一起跳出來，不會漏掉。也可以從貓咪的右鍵選單快速開啟。</p>
        <p className={`status ${dnd.active ? 'err' : 'ok'}`}>
          {until
            ? `勿擾中，到 ${until.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`
            : dnd.active
              ? '安靜時段中'
              : '目前會正常提醒'}
        </p>
        <div className="actions">
          <button onClick={async () => setDnd(await window.api.reminders.setDnd(60))}>勿擾 1 小時</button>
          <button disabled={!until} onClick={async () => setDnd(await window.api.reminders.setDnd(null))}>
            關閉勿擾
          </button>
        </div>

        <div className="field">
          <span>每天的安靜時段</span>
          <div className="row quiet-row">
            <input type="time" aria-label="開始" value={quiet.start} onChange={(e) => (setQuiet({ ...quiet, start: e.target.value }), setSaved(false))} />
            <span className="muted">到</span>
            <input type="time" aria-label="結束" value={quiet.end} onChange={(e) => (setQuiet({ ...quiet, end: e.target.value }), setSaved(false))} />
            <button
              onClick={async () => {
                setDnd(await window.api.reminders.setQuietHours(quiet.start || null, quiet.end || null))
                setSaved(true)
              }}
            >
              儲存
            </button>
            <button
              className="quiet"
              disabled={!dnd.quietStart}
              onClick={async () => {
                setQuiet({ start: '', end: '' })
                setDnd(await window.api.reminders.setQuietHours(null, null))
              }}
            >
              不使用
            </button>
          </div>
          <small>例如 22:00 到 08:00。{saved ? '已儲存。' : ''}</small>
        </div>
      </section>
    </div>
  )
}
