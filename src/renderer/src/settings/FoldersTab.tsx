import { useEffect, useState } from 'react'
import type { SettingsView } from '@shared/types'
import { Icon } from '../common/Icon'

export function FoldersTab() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setView)
  }, [])
  if (!view) return null

  const add = async () => {
    setError(null)
    try {
      setView(await window.api.settings.addAllowedFolder())
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div className="settings-page">
      <section>
        <h2>允許讀取的資料夾</h2>
        <p className="hint">喵助可以直接讀取這些資料夾（含子資料夾）裡的檔案，不會每次詢問。其他位置要讀取時會先問你。</p>
        <ul className="folder-list">
          {view.allowedFolders.map((f) => (
            <li key={f}>
              <span className="folder-path">
                <Icon name="folder" size={16} />
                {f}
              </span>
              <button onClick={async () => setView(await window.api.settings.removeAllowedFolder(f))}>移除</button>
            </li>
          ))}
          {view.allowedFolders.length === 0 && <li className="hint">（沒有任何資料夾，每次讀取都會詢問）</li>}
        </ul>
        <div className="actions">
          <button className="primary" onClick={add}>
            <Icon name="plus" size={15} />
            新增資料夾
          </button>
        </div>
        {error && <p className="status err">{error}</p>}
      </section>

      <section>
        <h2>敏感資料夾</h2>
        <p className="hint">
          放薪資、合約、個資等資料的資料夾。喵助一讀到這裡的檔案，這段對話就會改用本機模型回答，內容不會送到雲端；之後連網也會先問你。
        </p>
        <ul className="folder-list">
          {view.sensitiveFolders.map((f) => (
            <li key={f}>
              <span className="folder-path">
                <Icon name="folder" size={16} />
                {f}
              </span>
              <button onClick={async () => setView(await window.api.settings.removeSensitiveFolder(f))}>移除</button>
            </li>
          ))}
          {view.sensitiveFolders.length === 0 && <li className="hint">沒有設定敏感資料夾。</li>}
        </ul>
        <div className="actions">
          <button onClick={async () => setView(await window.api.settings.addSensitiveFolder())}>
            <Icon name="plus" size={15} />
            新增敏感資料夾
          </button>
        </div>
        <label className="field">
          <span>使用的本機模型</span>
          <select
            value={view.localProfileId ?? ''}
            onChange={async (e) => setView(await window.api.settings.setLocalProfile(e.target.value || null))}
          >
            <option value="">（未指定）</option>
            {view.profiles
              .filter((p) => p.isLocal)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.model}）
                </option>
              ))}
          </select>
          <small>
            {view.profiles.some((p) => p.isLocal)
              ? '沒有指定時，喵助不會讀取敏感資料夾裡的檔案。'
              : '還沒有本機模型連線。到「模型連線」新增 Ollama 或 LM Studio，並勾選「這是本機模型」。沒有指定時，喵助不會讀取敏感資料夾裡的檔案。'}
          </small>
        </label>
        {view.sensitiveFolders.length > 0 && !view.localProfileId && (
          <p className="status err">已設定敏感資料夾，但還沒指定本機模型：喵助會拒絕讀取這些資料夾。</p>
        )}
      </section>

      <section>
        <h2>需要確認的操作</h2>
        <table className="rule-table">
          <tbody>
            <tr>
              <td>讀取允許清單內的檔案、搜尋網路</td>
              <td className="rule-auto">直接進行</td>
            </tr>
            <tr>
              <td>讀取清單外的檔案、讀取公司內網網頁</td>
              <td className="rule-ask">先問你</td>
            </tr>
            <tr>
              <td>寫入、移動、刪除檔案（刪除一律移到垃圾桶）</td>
              <td className="rule-ask">每次都問</td>
            </tr>
            <tr>
              <td>執行指令、擷取螢幕</td>
              <td className="rule-ask">每次都問</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">確認時選「這次對話都允許」，在清除對話前同類操作就不會再問。</p>
      </section>

      <section>
        <h2>永遠禁止存取</h2>
        <p className="hint">這些位置含有帳號憑證、瀏覽器資料或喵助自己的金鑰，無論如何都不會讀取或修改。系統資料夾也不允許修改。</p>
        <pre className="blocked-list">{view.blockedPaths.join('\n')}</pre>
      </section>

      <section>
        <h2>操作紀錄</h2>
        <p className="hint">每一次工具操作（時間、內容、是否經過你的確認、結果）都會記錄在本機。</p>
        <div className="actions">
          <button onClick={() => window.api.settings.openAuditLog()}>在 Finder / 檔案總管中顯示</button>
        </div>
      </section>
    </div>
  )
}
