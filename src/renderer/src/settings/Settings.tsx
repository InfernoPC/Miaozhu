import { useEffect, useState } from 'react'
import { isOpenRouterURL, MAX_FALLBACK_MODELS, type ProviderProfile, type SaveProfileInput, type SettingsView, type TestResult } from '@shared/types'
import { FoldersTab } from './FoldersTab'
import { PersonaTab } from './PersonaTab'
import { SearchTab } from './SearchTab'
import './settings.css'

interface Preset {
  label: string
  name: string
  baseURL: string
  model: string
  isLocal?: boolean
  headers?: Record<string, string>
  fallbackModels?: string[]
  hint: string
}

/** Free OpenRouter models that handled Chinese + tool calling well in testing, best first. */
const RECOMMENDED_FREE_MODELS = [
  'google/gemma-4-31b-it:free',
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free'
]
const MAX_FALLBACKS = MAX_FALLBACK_MODELS

const PRESETS: Preset[] = [
  {
    label: '公司 AI Gateway',
    name: '公司 Gateway',
    baseURL: 'https://',
    model: '',
    hint: '填入 IT 提供的 Base URL（通常以 /v1 結尾）、API Key 與模型名稱。LiteLLM、One API 等 gateway 都適用。'
  },
  {
    label: 'OpenRouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: RECOMMENDED_FREE_MODELS[0],
    fallbackModels: RECOMMENDED_FREE_MODELS.slice(1, 1 + MAX_FALLBACKS),
    // Optional app attribution OpenRouter shows on its dashboard; not a secret.
    headers: { 'X-Title': 'Desktop Agent' },
    hint: '按下「用 OpenRouter 帳號登入」會開啟瀏覽器，登入並同意授權後就會自動取得 API Key。預設使用免費模型，主模型忙碌時會自動改用備用模型。'
  },
  {
    label: 'Azure OpenAI',
    name: 'Azure OpenAI',
    baseURL: 'https://<resource>.openai.azure.com/openai/v1',
    model: '',
    hint: '把 <resource> 換成你的 Azure 資源名稱；模型欄位填「部署名稱（deployment name）」。'
  },
  {
    label: 'OpenAI',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: '',
    hint: '到 platform.openai.com 建立 API Key，模型可按「取得模型清單」選擇。'
  },
  {
    label: 'Ollama（本機）',
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    model: '',
    isLocal: true,
    hint: '先安裝 Ollama 並下載模型（例如 ollama pull qwen3），不需要 API Key。'
  },
  {
    label: 'LM Studio（本機）',
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    model: '',
    isLocal: true,
    hint: '在 LM Studio 開啟「Local Server」，不需要 API Key。'
  }
]

const newProfile = (preset: Preset): ProviderProfile => ({
  id: crypto.randomUUID(),
  kind: 'openai-compatible',
  name: preset.name,
  baseURL: preset.baseURL,
  model: preset.model,
  isLocal: preset.isLocal,
  headers: preset.headers,
  fallbackModels: preset.fallbackModels
})

interface Draft {
  profile: ProviderProfile
  /** undefined = untouched (keep stored key). */
  apiKey?: string
  removeKey: boolean
  headersText: string
  fallbackText: string
  hint?: string
  isNew: boolean
}

const toDraft = (profile: ProviderProfile, isNew: boolean, hint?: string): Draft => ({
  profile,
  removeKey: false,
  headersText: profile.headers ? JSON.stringify(profile.headers, null, 2) : '',
  fallbackText: (profile.fallbackModels ?? []).join('\n'),
  hint,
  isNew
})

function ProfilesTab() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState<'test' | 'models' | 'save' | 'connect' | null>(null)

  useEffect(() => {
    void window.api.settings.get().then((v) => {
      setView(v)
      const active = v.profiles.find((p) => p.id === v.activeProfileId) ?? v.profiles[0]
      setDraft(active ? toDraft(active, false) : toDraft(newProfile(PRESETS[0]), true, PRESETS[0].hint))
    })
  }, [])

  if (!view || !draft) return null

  const stored = view.profiles.find((p) => p.id === draft.profile.id)
  const update = (patch: Partial<ProviderProfile>) => setDraft({ ...draft, profile: { ...draft.profile, ...patch } })

  const select = (id: string) => {
    const p = view.profiles.find((x) => x.id === id)
    if (!p) return
    setDraft(toDraft(p, false))
    setModels([])
    setStatus(null)
  }

  const startNew = (preset: Preset) => {
    setDraft(toDraft(newProfile(preset), true, preset.hint))
    setModels([])
    setStatus(null)
  }

  /** Builds the IPC payload, or reports a validation problem. */
  const buildInput = (): SaveProfileInput | null => {
    let headers: Record<string, string> | undefined
    if (draft.headersText.trim()) {
      try {
        headers = JSON.parse(draft.headersText)
      } catch {
        setStatus({ ok: false, message: '額外 Header 必須是 JSON 格式，例如 {"X-Tenant": "abc"}' })
        return null
      }
    }
    const fallbackModels = draft.fallbackText.split(/\s+/).filter(Boolean)
    if (fallbackModels.length > MAX_FALLBACKS) {
      setStatus({ ok: false, message: `備用模型最多 ${MAX_FALLBACKS} 個` })
      return null
    }
    const profile = {
      ...draft.profile,
      headers,
      fallbackModels: fallbackModels.length ? fallbackModels : undefined,
      baseURL: draft.profile.baseURL.trim().replace(/\/+$/, '')
    }
    if (!/^https?:\/\/[^<>\s]+$/.test(profile.baseURL)) {
      setStatus({ ok: false, message: 'Base URL 格式不正確，需以 http:// 或 https:// 開頭' })
      return null
    }
    const apiKey = draft.removeKey ? '' : draft.apiKey?.trim() || undefined
    return { profile, apiKey }
  }

  const run = async (kind: 'test' | 'models' | 'save' | 'connect', fn: (input: SaveProfileInput) => Promise<void>) => {
    const input = buildInput()
    if (!input) return
    setBusy(kind)
    setStatus(null)
    try {
      await fn(input)
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', async (input) => {
      if (!input.profile.name.trim() || !input.profile.model.trim()) {
        setStatus({ ok: false, message: '請填寫名稱與模型' })
        return
      }
      const v = await window.api.settings.saveProfile(input)
      setView(v)
      setDraft(toDraft(input.profile, false))
      setStatus({ ok: true, message: '已儲存' })
    })

  const connect = () =>
    run('connect', async (input) => {
      setStatus({ ok: true, message: '已開啟瀏覽器，請登入 OpenRouter 並按下授權…' })
      const v = await window.api.settings.connectOpenRouter(input)
      setView(v)
      setDraft(toDraft(input.profile, false))
      setStatus({ ok: true, message: '已連接 OpenRouter，API Key 已自動儲存 🎉 可以按「測試連線」試試看' })
    })

  const remove = async () => {
    const v = await window.api.settings.deleteProfile(draft.profile.id)
    setView(v)
    const next = v.profiles[0]
    setDraft(next ? toDraft(next, false) : toDraft(newProfile(PRESETS[0]), true, PRESETS[0].hint))
    setStatus(null)
  }

  const keyPlaceholder = draft.profile.isLocal
    ? '本機模型通常不需要'
    : stored?.hasKey && !draft.removeKey
      ? '已安全儲存（留空表示不變更）'
      : '貼上 API Key'

  return (
    <div className="settings">
      <aside className="settings-side">
        <h3>已儲存的連線</h3>
        <ul className="profile-list">
          {view.profiles.map((p) => (
            <li key={p.id}>
              <button className={p.id === draft.profile.id ? 'selected' : ''} onClick={() => select(p.id)}>
                <span className="profile-name">
                  {p.name}
                  {p.id === view.activeProfileId && <span className="badge">使用中</span>}
                </span>
                <span className="profile-model">{p.model}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="field">
          <span>新增連線</span>
          <select
            value=""
            onChange={(ev) => {
              const preset = PRESETS[Number(ev.target.value)]
              if (preset) startNew(preset)
            }}
          >
            <option value="" disabled>
              選擇類型…
            </option>
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </aside>

      <main className="settings-main">
        <h2>{draft.isNew ? '新增連線' : '編輯連線'}</h2>
        {draft.hint && <p className="hint">{draft.hint}</p>}

        <label className="field">
          <span>名稱</span>
          <input value={draft.profile.name} onChange={(ev) => update({ name: ev.target.value })} />
        </label>

        <label className="field">
          <span>Base URL</span>
          <input
            value={draft.profile.baseURL}
            spellCheck={false}
            placeholder="https://ai-gateway.example.com/v1"
            onChange={(ev) => update({ baseURL: ev.target.value })}
          />
        </label>

        <label className="field">
          <span>API Key</span>
          <div className="row">
            <input
              type="password"
              value={draft.apiKey ?? ''}
              placeholder={keyPlaceholder}
              autoComplete="off"
              onChange={(ev) => setDraft({ ...draft, apiKey: ev.target.value, removeKey: false })}
            />
            {stored?.hasKey && !draft.removeKey && (
              <button type="button" onClick={() => setDraft({ ...draft, apiKey: undefined, removeKey: true })}>
                移除
              </button>
            )}
          </div>
          <small>以作業系統鑰匙圈加密（macOS Keychain / Windows DPAPI），只存在這台電腦。</small>
          {isOpenRouterURL(draft.profile.baseURL) && (
            <div className="row oauth-row">
              <button type="button" className="primary" disabled={busy !== null} onClick={connect}>
                {busy === 'connect' ? '等待瀏覽器授權中…' : stored?.hasKey ? '重新登入 OpenRouter' : '用 OpenRouter 帳號登入（自動取得 API Key）'}
              </button>
              {busy === 'connect' && (
                <button type="button" onClick={() => window.api.settings.cancelConnect()}>
                  取消
                </button>
              )}
            </div>
          )}
        </label>

        <label className="field">
          <span>模型</span>
          <div className="row">
            <input
              value={draft.profile.model}
              list="model-options"
              spellCheck={false}
              placeholder="例如 gpt-4.1、qwen3、部署名稱"
              onChange={(ev) => update({ model: ev.target.value })}
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run('models', async (input) => {
                  const list = await window.api.settings.listModels(input)
                  setModels(list)
                  setStatus({ ok: true, message: `找到 ${list.length} 個模型，可在模型欄位下拉選擇` })
                })
              }
            >
              {busy === 'models' ? '讀取中…' : '取得模型清單'}
            </button>
          </div>
          <datalist id="model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>

        {draft.profile.model.trim() === 'openrouter/auto' && (
          <p className="status err">
            openrouter/auto 會自動挑選模型，可能選到付費模型而產生費用。免費帳號建議改用結尾是 :free 的模型。
          </p>
        )}

        {!draft.profile.isLocal && (
          <label className="field">
            <span>備用模型（選填，最多 {MAX_FALLBACKS} 個，一行一個）</span>
            <textarea
              rows={3}
              spellCheck={false}
              value={draft.fallbackText}
              placeholder={RECOMMENDED_FREE_MODELS.slice(1).join('\n')}
              onChange={(ev) => setDraft({ ...draft, fallbackText: ev.target.value })}
            />
            <div className="row">
              <small>主模型忙碌（429）或無法使用時，會依序改用這些模型。OpenRouter 免費模型常常塞車，建議填寫。</small>
              {isOpenRouterURL(draft.profile.baseURL) && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run('models', async (input) => {
                      const available = new Set(await window.api.settings.listModels(input))
                      const picks = RECOMMENDED_FREE_MODELS.filter((m) => available.has(m))
                      if (!picks.length) {
                        setStatus({ ok: false, message: '目前找不到推薦的免費模型，請手動填寫' })
                        return
                      }
                      setDraft({
                        ...draft,
                        profile: { ...draft.profile, model: picks[0] },
                        fallbackText: picks.slice(1, 1 + MAX_FALLBACKS).join('\n')
                      })
                      setStatus({ ok: true, message: `已填入 ${picks.length} 個免費模型，記得按「儲存」` })
                    })
                  }
                >
                  填入推薦免費模型
                </button>
              )}
            </div>
          </label>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!draft.profile.isLocal}
            onChange={(ev) => update({ isLocal: ev.target.checked })}
          />
          這是本機模型（資料不會離開這台電腦）
        </label>

        <details className="advanced">
          <summary>進階：額外 HTTP Header</summary>
          <textarea
            rows={3}
            spellCheck={false}
            value={draft.headersText}
            placeholder='{"X-Tenant-Id": "my-team"}'
            onChange={(ev) => setDraft({ ...draft, headersText: ev.target.value })}
          />
          <small>部分公司 gateway 需要額外 Header。請不要把金鑰放在這裡，金鑰請填在 API Key 欄位。</small>
        </details>

        {status && <p className={`status ${status.ok ? 'ok' : 'err'}`}>{status.message}</p>}

        <div className="actions">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('test', async (input) => setStatus(await window.api.settings.test(input)))}
          >
            {busy === 'test' ? '測試中…' : '測試連線'}
          </button>
          <button type="button" className="primary" disabled={busy !== null} onClick={save}>
            儲存
          </button>
          {!draft.isNew && draft.profile.id !== view.activeProfileId && (
            <button type="button" onClick={async () => setView(await window.api.settings.setActive(draft.profile.id))}>
              設為使用中
            </button>
          )}
          {!draft.isNew && (
            <button type="button" className="danger" onClick={remove}>
              刪除
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

const TABS = [
  { id: 'profiles', label: '模型連線', View: ProfilesTab },
  { id: 'persona', label: '角色', View: PersonaTab },
  { id: 'folders', label: '檔案權限', View: FoldersTab },
  { id: 'search', label: '網路搜尋', View: SearchTab }
] as const

export function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('profiles')
  const View = TABS.find((t) => t.id === tab)!.View
  return (
    <div className="settings-shell">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        <View />
      </div>
    </div>
  )
}
