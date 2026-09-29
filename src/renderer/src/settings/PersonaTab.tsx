import { useEffect, useState } from 'react'
import type { SettingsView, TestResult } from '@shared/types'

/** Starting points people can apply and then edit. */
const EXAMPLES = [
  {
    label: '傲嬌黑貓',
    text: `你是一隻傲嬌的黑貓，名字叫「小墨」，住在使用者的桌面上。
- 嘴上有點不耐煩，但一定會把事情做好，偶爾說「哼，才不是為了你」。
- 回答簡短，先給結論。`
  },
  {
    label: '行政秘書',
    text: `你是使用者的行政秘書，名字叫「喵助」。
- 語氣專業、有禮貌，不使用語助詞或表情符號。
- 回答條列清楚，先給結論，再列出需要使用者決定的事項。`
  },
  {
    label: '工程師夥伴',
    text: `你是陪使用者寫程式的貓咪夥伴，名字叫「喵助」。
- 講重點，能用指令或程式碼說明就不用長篇文字。
- 提到指令時標明是 macOS 還是 Windows 用的。`
  }
]

export function PersonaTab() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<TestResult | null>(null)

  useEffect(() => {
    void window.api.settings.get().then((v) => {
      setView(v)
      setDraft(v.persona)
    })
  }, [])
  if (!view) return null

  const dirty = draft.trim() !== view.persona.trim()
  const save = async (text: string, message: string) => {
    const v = await window.api.settings.savePersona(text)
    setView(v)
    setDraft(v.persona)
    setStatus({ ok: true, message })
  }

  return (
    <div className="settings-page">
      <section>
        <h2>角色設定</h2>
        <p className="hint">決定喵助是誰、怎麼說話：名字、個性、口頭禪、回答長短。下一則訊息開始生效。</p>

        <label className="field">
          <span>角色描述</span>
          <textarea
            rows={8}
            value={draft}
            maxLength={view.maxPersonaChars}
            onChange={(e) => {
              setDraft(e.target.value)
              setStatus(null)
            }}
          />
          <small>
            {draft.length} / {view.maxPersonaChars} 字{view.personaIsDefault && !dirty ? '，目前使用預設角色' : ''}
          </small>
        </label>

        <div className="field">
          <span>套用範例</span>
          <div className="example-row">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => {
                  setDraft(ex.text)
                  setStatus(null)
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
          <small>套用後可以再修改，按「儲存」才會生效。</small>
        </div>

        {status && <p className={`status ${status.ok ? 'ok' : 'err'}`}>{status.message}</p>}

        <div className="actions">
          <button className="primary" disabled={!dirty} onClick={() => save(draft, '已儲存，下一則訊息開始使用新角色')}>
            儲存
          </button>
          <button disabled={view.personaIsDefault && draft.trim() === view.defaultPersona.trim()} onClick={() => save('', '已恢復預設角色')}>
            恢復預設
          </button>
        </div>
      </section>

      <section>
        <details className="advanced">
          <summary>固定規則（角色設定無法覆蓋）</summary>
          <p className="hint">
            這些規則永遠有效，確保無論角色怎麼設定，喵助都會用你的語言回答、不編造、遵守權限確認，也不會照著檔案或網頁裡的指示去做事。
          </p>
          <pre className="blocked-list fixed-rules">{view.fixedRules}</pre>
        </details>
      </section>
    </div>
  )
}
