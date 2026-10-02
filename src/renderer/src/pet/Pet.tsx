import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AttachmentView, DueReminder, LoadedSkin, PermissionRequest, PetSkinId, PetState, UpdateStatus } from '@shared/types'
import { AttachmentChips, droppedPaths } from '../common/AttachmentChips'
import { Icon } from '../common/Icon'
import { Markdown } from '../common/Markdown'
import { PermissionPrompt } from '../common/PermissionPrompt'
import { SKINS } from './renderer'
import { SkinPack } from './SkinPack'
import './pet.css'

const SLEEP_AFTER_MS = 5 * 60_000
const DRAG_THRESHOLD_PX = 4
const DOUBLE_CLICK_MS = 250

interface Bubble {
  text: string
  error?: boolean
  streaming: boolean
}

const QUICK_ACTIONS: Record<AttachmentView['kind'], string[]> = {
  file: ['摘要重點', '翻譯成英文', '找出需要注意的地方'],
  image: ['說明這張圖', '擷取圖中文字'],
  folder: ['整理這個資料夾', '列出最近修改的檔案']
}

/** How long a finished reply stays on screen: longer answers get more reading time. */
const bubbleDuration = (text: string) => Math.min(30_000, 6_000 + text.length * 60)

export function Pet() {
  const [state, setState] = useState<PetState>('idle')
  const [skin, setSkin] = useState<PetSkinId>('desk')
  const [pack, setPack] = useState<LoadedSkin | null>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [due, setDue] = useState<DueReminder[]>([])
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updating, setUpdating] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<AttachmentView[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)
  const sleepTimer = useRef<number | undefined>(undefined)

  const markBusy = (b: boolean) => {
    busyRef.current = b
    setBusy(b)
  }

  const wake = () => {
    window.clearTimeout(sleepTimer.current)
    setState((s) => (s === 'sleeping' ? 'idle' : s))
    sleepTimer.current = window.setTimeout(() => {
      if (!busyRef.current) setState('sleeping')
    }, SLEEP_AFTER_MS)
  }

  // An installed skin pack is read by main and handed over as data.
  useEffect(() => {
    if (skin in SKINS) return setPack(null)
    let live = true
    void window.api.skins.load(skin).then((p) => live && setPack(p))
    return () => {
      live = false
    }
  }, [skin])

  // Due reminders queue up; the cat jumps until each one is answered.
  useEffect(
    () =>
      window.api.reminders.onDue((r) => {
        setDue((list) => (list.some((x) => x.id === r.id) ? list : [...list, r]))
        setState('alert')
      }),
    []
  )
  useEffect(() => window.api.updates.onAvailable(setUpdate), [])
  const installUpdate = async () => {
    setUpdating(true)
    try {
      await window.api.updates.install()
    } catch {
      setUpdating(false)
      setUpdate(null)
      window.api.windows.openSettings()
    }
  }

  const answerReminder = (r: DueReminder, action: 'dismiss' | 'snooze') => {
    void (action === 'dismiss' ? window.api.reminders.dismiss(r.id) : window.api.reminders.snooze(r.id, 10))
    setDue((list) => {
      const rest = list.filter((x) => x.id !== r.id)
      if (!rest.length) setState((s) => (s === 'alert' ? 'idle' : s))
      return rest
    })
  }

  useEffect(() => {
    void window.api.settings.get().then((v) => setSkin(v.petSkin))
    void window.api.agent.pendingPermissions().then(setPermissions)
    return window.api.pet.onSkinChange(setSkin)
  }, [])

  // Agent events drive the cat's state and the speech bubble.
  useEffect(() => {
    wake()
    return window.api.agent.onEvent((e) => {
      if (e.type === 'permission-request') {
        setPermissions((ps) => [...ps, e.request])
        setState('alert')
        return
      }
      if (e.type === 'permission-resolved') {
        setPermissions((ps) => ps.filter((p) => p.id !== e.id))
        setState((s) => (s === 'alert' ? 'working' : s))
        return
      }
      window.clearTimeout(hideTimer.current)
      if (e.type === 'turn-start') {
        markBusy(true)
        setState('thinking')
        setBubble(null)
        setToolStatus(null)
      } else if (e.type === 'delta') {
        setState('talking')
        setToolStatus(null)
        setBubble((b) => ({ text: (b?.text ?? '') + e.text, streaming: true }))
      } else if (e.type === 'tool') {
        if (e.tool.status === 'running') {
          setState('working')
          setToolStatus(e.tool.title)
        } else if (e.tool.status !== 'waiting-approval') {
          setState('thinking')
        }
      } else if (e.type === 'turn-end') {
        markBusy(false)
        setToolStatus(null)
        const { text, error } = e.message
        setState(error ? 'error' : 'idle')
        setBubble({ text: error ? `${text ? text + '\n\n' : ''}**沒辦法完成：**${error}` : text, error: !!error, streaming: false })
        hideTimer.current = window.setTimeout(() => {
          setBubble(null)
          setState((s) => (s === 'error' ? 'idle' : s))
        }, bubbleDuration(text))
        wake()
      } else if (e.type === 'history-cleared' || e.type === 'conversation-changed') {
        markBusy(false)
        setBubble(null)
        setToolStatus(null)
        setPermissions([])
        setState('idle')
      }
    })
  }, [])

  // Keep the newest streamed text visible.
  useEffect(() => {
    const el = bubbleRef.current
    if (el && bubble?.streaming) el.scrollTop = el.scrollHeight
  }, [bubble])

  // Tell main which regions are clickable; everything else lets clicks through to the desktop.
  useLayoutEffect(() => {
    const report = () => {
      const rects = [...(rootRef.current?.querySelectorAll('.hit') ?? [])].map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 }
      })
      window.api.pet.setHitRects(rects)
    }
    report()
    const ro = new ResizeObserver(report)
    rootRef.current?.querySelectorAll('.hit').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  })

  useEffect(() => {
    if (inputOpen) inputRef.current?.focus()
  }, [inputOpen, attachments])

  // Pointer handling on the cat: drag moves the window, click opens input, double-click opens chat.
  const pointer = useRef<{ x: number; y: number; dragging: boolean } | null>(null)
  const clickTimer = useRef<number | undefined>(undefined)

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return
    ev.currentTarget.setPointerCapture(ev.pointerId)
    pointer.current = { x: ev.screenX, y: ev.screenY, dragging: false }
    wake()
  }

  const onPointerMove = (ev: React.PointerEvent) => {
    const p = pointer.current
    if (!p) return
    if (!p.dragging && Math.hypot(ev.screenX - p.x, ev.screenY - p.y) > DRAG_THRESHOLD_PX) {
      p.dragging = true
      window.api.pet.dragStart()
    }
    if (p.dragging) window.api.pet.dragMove()
  }

  const onPointerUp = () => {
    const p = pointer.current
    pointer.current = null
    if (!p) return
    if (p.dragging) return window.api.pet.dragEnd()
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = undefined
      window.api.windows.openChat()
      return
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = undefined
      setInputOpen((open) => !open)
      setState((s) => (busyRef.current ? s : s === 'listening' ? 'idle' : 'listening'))
    }, DOUBLE_CLICK_MS)
  }

  const closeInput = () => {
    setInputOpen(false)
    setDraft('')
    setAttachments([])
    setState((s) => (s === 'listening' ? 'idle' : s))
  }

  const submit = (text = draft) => {
    if (!text.trim() && !attachments.length) return
    const paths = attachments.map((a) => a.path)
    closeInput()
    void window.api.agent.send(text.trim(), paths)
  }

  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault()
    setDragOver(false)
    const paths = droppedPaths(ev)
    if (!paths.length) return
    const views = await window.api.agent.describeAttachments(paths)
    setAttachments((prev) => [...prev, ...views.filter((v) => !prev.some((p) => p.path === v.path))])
    setInputOpen(true)
    setState('listening')
    wake()
  }

  const dropProps = {
    onDragOver: (ev: React.DragEvent) => {
      ev.preventDefault()
      if (!dragOver) {
        setDragOver(true)
        setState((s) => (busyRef.current ? s : 'listening'))
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop
  }

  const Character = SKINS[skin] ?? SKINS.desk
  const character = pack ? <SkinPack skin={pack} state={state} /> : <Character state={state} />
  const permission = permissions[0]
  const reminder = due[0]
  const quick = attachments.length ? QUICK_ACTIONS[attachments[0].kind] : []

  return (
    <div className="pet-root" ref={rootRef}>
      <div className="pet-top">
        {permission ? (
          <div className="bubble hit">
            <PermissionPrompt request={permission} compact />
            {permissions.length > 1 && <div className="bubble-more">還有 {permissions.length - 1} 個操作等待確認</div>}
          </div>
        ) : reminder ? (
          <div className="bubble hit bubble-reminder" role="alert">
            <div className="bubble-scroll">
              <p className="reminder-kicker">{reminder.late ? '錯過的提醒' : '提醒'}</p>
              <p className="reminder-text">{reminder.text}</p>
              <p className="reminder-when">
                {new Date(reminder.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                {due.length > 1 ? `，還有 ${due.length - 1} 個` : ''}
              </p>
            </div>
            <div className="bubble-actions">
              <button className="primary" autoFocus onClick={() => answerReminder(reminder, 'dismiss')}>
                好
              </button>
              <button onClick={() => answerReminder(reminder, 'snooze')}>10 分鐘後</button>
              <button className="quiet" onClick={() => window.api.windows.openChat()}>
                打開對話
              </button>
            </div>
          </div>
        ) : update && !bubble && !toolStatus ? (
          <div className="bubble hit bubble-reminder">
            <div className="bubble-scroll">
              <p className="reminder-kicker">有新版本</p>
              <p className="reminder-text">喵助 {update.latest} 出來了</p>
              <p className="reminder-when">{updating ? '更新中，等一下會自動重新開啟…' : `目前是 ${update.current}`}</p>
            </div>
            <div className="bubble-actions">
              <button className="primary" disabled={updating} onClick={installUpdate}>
                更新
              </button>
              <button disabled={updating} onClick={() => setUpdate(null)}>
                稍後
              </button>
            </div>
          </div>
        ) : (
          (bubble || toolStatus) && (
            <div className={`bubble hit ${bubble?.error ? 'bubble-error' : ''}`}>
              <div className="bubble-text" ref={bubbleRef}>
                {bubble?.text ? (
                  <Markdown text={bubble.text} />
                ) : (
                  <span className="bubble-status">
                    <Icon name="gear" size={14} className="spin" />
                    {toolStatus ?? '想一下…'}
                  </span>
                )}
              </div>
              <div className="bubble-actions">
                <button className="quiet" onClick={() => window.api.windows.openChat()}>
                  打開對話
                </button>
                {busy ? (
                  <button className="quiet" onClick={() => window.api.agent.cancel()}>
                    停下來
                  </button>
                ) : (
                  <button className="quiet" onClick={() => setBubble(null)}>
                    收起
                  </button>
                )}
              </div>
            </div>
          )
        )}
        {inputOpen && (
          <form
            className="pet-input hit"
            {...dropProps}
            onSubmit={(ev) => {
              ev.preventDefault()
              submit()
            }}
          >
            {attachments.length > 0 && (
              <div className="pet-attach">
                <AttachmentChips items={attachments} onRemove={(p) => setAttachments((as) => as.filter((a) => a.path !== p))} />
                <div className="quick">
                  {quick.map((q) => (
                    <button type="button" key={q} onClick={() => submit(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <input
              ref={inputRef}
              value={draft}
              placeholder={attachments.length ? '要我怎麼處理？' : '想問什麼？Enter 送出，Esc 收起'}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => ev.key === 'Escape' && closeInput()}
            />
          </form>
        )}
      </div>

      <div
        className={`cat-hit hit ${dragOver ? 'drag-over' : ''}`}
        title="點一下說話，點兩下打開對話，拖曳可移動，也可以把檔案丟給我"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(ev) => {
          ev.preventDefault()
          window.api.pet.showMenu()
        }}
        {...dropProps}
      >
        {character}
      </div>
    </div>
  )
}
