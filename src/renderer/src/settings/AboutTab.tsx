import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

const INSTALL_MAC = 'curl -fsSL https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.sh | bash'
const INSTALL_WIN = 'irm https://github.com/InfernoPC/Miaozhu/releases/latest/download/install.ps1 | iex'

export function AboutTab() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.updates.status().then(setStatus)
    return window.api.updates.onAvailable(setStatus)
  }, [])
  if (!status) return null

  const check = async () => {
    setChecking(true)
    setStatus(await window.api.updates.check())
    setChecking(false)
  }
  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      await window.api.updates.install()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setInstalling(false)
    }
  }
  const isWin = navigator.userAgent.includes('Windows')

  return (
    <div className="settings-page">
      <section>
        <h2>喵助 {status.current}</h2>
        {status.available ? (
          <>
            <p className="status ok">有新版本 {status.latest}</p>
            {status.notes && <p className="hint about-notes">{status.notes}</p>}
            <div className="row">
              <button className="primary" disabled={installing} onClick={install}>
                {installing ? '更新中，喵助會自動重新開啟…' : `更新到 ${status.latest}`}
              </button>
              <button className="quiet" onClick={() => window.api.updates.openReleasePage()}>
                看更新內容
              </button>
            </div>
          </>
        ) : (
          <p className="hint">
            {status.error
              ? status.error
              : status.checkedAt
                ? `已經是最新版（${new Date(status.checkedAt).toLocaleString('zh-TW', { hour12: false })} 檢查）`
                : '喵助每 6 小時會自動檢查一次更新。'}
          </p>
        )}
        {error && <p className="status err">{error}</p>}
        {!status.available && (
          <div className="row">
            <button disabled={checking} onClick={check}>
              {checking ? '檢查中…' : '檢查更新'}
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>安裝到其他電腦</h2>
        <p className="hint">{isWin ? '在 PowerShell 貼上這一行：' : '在「終端機」貼上這一行：'}</p>
        <pre className="about-command">{isWin ? INSTALL_WIN : INSTALL_MAC}</pre>
        <p className="hint">同一行指令也能用來手動更新或重新安裝，設定和對話都會保留。</p>
      </section>
    </div>
  )
}
