import { useEffect, useState } from 'react'
import type { SaveSearchInput, SearchProvider, SettingsView, TestResult } from '@shared/types'

const PROVIDERS: { id: SearchProvider; label: string; needsKey: boolean; hint: string }[] = [
  { id: 'none', label: '不使用', needsKey: false, hint: '喵助將無法上網搜尋，但仍可讀取你提供的網址。' },
  {
    id: 'serper',
    label: 'Google（透過 Serper）',
    needsKey: true,
    hint: '使用 Google 搜尋結果。到 serper.dev 註冊（免信用卡）即可取得 API Key，送 2,500 次免費搜尋。Google 官方搜尋 API 已停止受理新申請，所以透過 Serper 取得。'
  },
  {
    id: 'tavily',
    label: 'Tavily',
    needsKey: true,
    hint: '到 tavily.com 註冊即可取得 API Key，每月有免費額度，結果適合給 AI 閱讀。'
  },
  { id: 'brave', label: 'Brave Search', needsKey: true, hint: '到 brave.com/search/api 申請 API Key，有免費方案。' },
  { id: 'searxng', label: 'SearXNG（自架）', needsKey: false, hint: '填入公司或自架的 SearXNG 網址，需開啟 JSON 輸出格式。' }
]

export function SearchTab() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [provider, setProvider] = useState<SearchProvider>('none')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<TestResult | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.settings.get().then((v) => {
      setView(v)
      setProvider(v.search.provider)
      setBaseURL(v.search.baseURL ?? '')
    })
  }, [])
  if (!view) return null

  const meta = PROVIDERS.find((p) => p.id === provider)!
  const input = (): SaveSearchInput => ({
    config: { provider, baseURL: provider === 'searxng' ? baseURL.trim() : undefined },
    apiKey: apiKey?.trim() || undefined
  })
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setStatus(null)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <section>
        <h2>網路搜尋服務</h2>
        <p className="hint">喵助需要搜尋服務才能查詢最新資訊。搜尋在這台電腦上執行，任何模型都能使用。</p>

        <label className="field">
          <span>服務</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as SearchProvider)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <small>{meta.hint}</small>
        </label>

        {meta.needsKey && (
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey ?? ''}
              placeholder={view.search.hasKey ? '已安全儲存（留空表示不變更）' : '貼上 API Key'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
        )}

        {provider === 'searxng' && (
          <label className="field">
            <span>SearXNG 網址</span>
            <input value={baseURL} spellCheck={false} placeholder="https://searx.example.com" onChange={(e) => setBaseURL(e.target.value)} />
          </label>
        )}

        {status && <p className={`status ${status.ok ? 'ok' : 'err'}`}>{status.message}</p>}

        <div className="actions">
          {provider !== 'none' && (
            <button disabled={busy} onClick={() => run(async () => setStatus(await window.api.settings.testSearch(input())))}>
              {busy ? '測試中…' : '測試搜尋'}
            </button>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setView(await window.api.settings.saveSearch(input()))
                setApiKey(undefined)
                setStatus({ ok: true, message: '已儲存' })
              })
            }
          >
            儲存
          </button>
        </div>
      </section>
    </div>
  )
}
