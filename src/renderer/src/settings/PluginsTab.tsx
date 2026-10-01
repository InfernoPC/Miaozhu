import { useEffect, useState } from 'react'
import type { PluginMcpView, PluginPreview, PluginSource, PluginView, ToolRisk } from '@shared/types'
import { Icon } from '../common/Icon'

const RISK_LABEL: Record<ToolRisk, string> = {
  read: '讀取',
  network: '連網',
  screen: '看螢幕',
  write: '修改檔案',
  execute: '執行程式'
}

const STATUS_LABEL: Record<PluginMcpView['status'], string> = {
  stopped: '已停止',
  starting: '啟動中',
  running: '執行中',
  error: '無法啟動'
}

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** What a plugin adds, shown both before installing and in the installed list. */
function PluginContents({ p, preview }: { p: PluginView; preview?: boolean }) {
  return (
    <div className="plugin-contents">
      {p.skills.length > 0 && (
        <div>
          <h4>技能 {p.skills.length}</h4>
          <ul>
            {p.skills.map((s) => (
              <li key={s.name}>
                <strong>{s.name}</strong>
                {s.description && <span className="muted">{s.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.mcpServers.length > 0 && (
        <div>
          <h4>MCP 伺服器 {p.mcpServers.length}</h4>
          <ul>
            {p.mcpServers.map((m) => (
              <li key={m.name}>
                <div className="row-between">
                  <strong>{m.name}</strong>
                  {!preview && (
                    <span className={`mcp-status mcp-${m.status}`}>
                      {STATUS_LABEL[m.status]}
                      {m.status === 'running' ? `，${m.toolCount} 個工具` : ''}
                    </span>
                  )}
                </div>
                <code className="target">{m.target}</code>
                {m.error && <pre className="mcp-error">{m.error}</pre>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.tools.length > 0 && (
        <div>
          <h4>工具 {p.tools.length}</h4>
          <ul>
            {p.tools.map((t) => (
              <li key={t.name}>
                <div className="row-between">
                  <strong>{t.name}</strong>
                  <span className={`risk-tag risk-${t.risk}`}>{RISK_LABEL[t.risk]}</span>
                </div>
                <span className="muted">{t.description}</span>
                <code className="target">{t.target}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.warnings.length > 0 && (
        <ul className="plugin-warnings">
          {p.warnings.map((w) => (
            <li key={w}>
              <Icon name="alert" size={13} /> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SecretFields({ p, onSaved }: { p: PluginView; onSaved: (list: PluginView[]) => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  if (!p.secrets.length) return null
  return (
    <div className="plugin-secrets">
      <h4>密鑰</h4>
      {p.secrets.map((s) => (
        <label key={s.name} className="row">
          <span className="secret-name">{s.name}</span>
          <input
            type="password"
            autoComplete="off"
            value={values[s.name] ?? ''}
            placeholder={s.isSet ? '已安全儲存（留空表示不變更）' : '貼上這個工具需要的密鑰'}
            onChange={(e) => setValues({ ...values, [s.name]: e.target.value })}
          />
          <button
            disabled={!values[s.name]}
            onClick={async () => {
              onSaved(await window.api.plugins.setSecret(p.id, s.name, values[s.name]))
              setValues({ ...values, [s.name]: '' })
            }}
          >
            儲存
          </button>
        </label>
      ))}
    </div>
  )
}

export function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginView[]>([])
  const [preview, setPreview] = useState<PluginPreview | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => void window.api.plugins.list().then(setPlugins)
    refresh()
    return window.api.plugins.onChange(refresh)
  }, [])

  const inspect = async (source: PluginSource, label: string) => {
    setError(null)
    setBusy(label)
    try {
      if (preview) await window.api.plugins.cancelInstall(preview.stagingId)
      setPreview(await window.api.plugins.inspect(source))
    } catch (e) {
      setError(stripIpc(e))
    } finally {
      setBusy(null)
    }
  }

  const install = async () => {
    if (!preview) return
    setBusy('安裝中…')
    try {
      setPlugins(await window.api.plugins.install(preview.stagingId))
      setOpen(preview.plugin.id)
      setPreview(null)
      setGitUrl('')
    } catch (e) {
      setError(stripIpc(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-page">
      <section>
        <h2>外掛</h2>
        <p className="hint">
          外掛可以幫喵助加上技能（工作流程、公司知識）、MCP 伺服器與自訂工具，格式與 Claude Code 外掛相容。安裝前會先列出它會加入的所有東西讓你確認。
        </p>
        <div className="actions">
          <button disabled={!!busy} onClick={() => inspect({ kind: 'folder' }, '讀取資料夾…')}>
            <Icon name="folder" size={15} />
            從資料夾安裝
          </button>
          <button disabled={!!busy} onClick={() => inspect({ kind: 'zip' }, '解壓縮中…')}>
            <Icon name="file" size={15} />
            從 zip 安裝
          </button>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (gitUrl.trim()) void inspect({ kind: 'git', url: gitUrl.trim() }, '下載中…')
          }}
        >
          <input value={gitUrl} spellCheck={false} placeholder="或貼上 Git 網址，例如 https://github.com/xxx/plugin.git" onChange={(e) => setGitUrl(e.target.value)} />
          <button type="submit" disabled={!!busy || !gitUrl.trim()}>
            讀取
          </button>
        </form>
        {busy && <p className="hint">{busy}</p>}
        {error && <p className="status err">{error}</p>}
      </section>

      {preview && (
        <section className="plugin-review" aria-label="安裝前確認">
          <h3>
            {preview.plugin.name}
            {preview.plugin.version && <span className="muted"> {preview.plugin.version}</span>}
          </h3>
          {preview.plugin.description && <p className="hint">{preview.plugin.description}</p>}
          {preview.replaces && <p className="status err">會取代已安裝的「{preview.replaces}」</p>}
          <p className="hint">
            請確認下列內容。MCP 伺服器會在你的電腦上執行下面列出的指令；之後每次使用工具時，仍會依風險等級先問你。
          </p>
          <PluginContents p={preview.plugin} preview />
          <div className="actions">
            <button className="primary" disabled={!!busy} onClick={install}>
              安裝
            </button>
            <button
              className="quiet"
              onClick={async () => {
                await window.api.plugins.cancelInstall(preview.stagingId)
                setPreview(null)
              }}
            >
              取消
            </button>
          </div>
        </section>
      )}

      <section>
        <h2>已安裝</h2>
        {plugins.length === 0 && <p className="hint">還沒有安裝任何外掛。</p>}
        <ul className="plugin-list">
          {plugins.map((p) => {
            const failing = p.mcpServers.filter((m) => m.status === 'error').length
            const missingSecrets = p.secrets.filter((s) => !s.isSet).length
            return (
              <li key={p.id} className={p.enabled ? '' : 'plugin-off'}>
                <div className="plugin-head">
                  <button className="plugin-name quiet" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    <strong>{p.name}</strong>
                    {p.version && <span className="muted"> {p.version}</span>}
                  </button>
                  <span className="plugin-summary">
                    {[
                      p.skills.length && `${p.skills.length} 個技能`,
                      p.mcpServers.length && `${p.mcpServers.length} 個 MCP`,
                      p.tools.length && `${p.tools.length} 個工具`
                    ]
                      .filter(Boolean)
                      .join('，')}
                    {failing > 0 && <span className="danger-text">，{failing} 個無法啟動</span>}
                    {missingSecrets > 0 && <span className="danger-text">，缺 {missingSecrets} 個密鑰</span>}
                  </span>
                  <label className="checkbox">
                    <input type="checkbox" checked={p.enabled} onChange={async (e) => setPlugins(await window.api.plugins.setEnabled(p.id, e.target.checked))} />
                    啟用
                  </label>
                </div>
                {open === p.id && (
                  <div className="plugin-body">
                    {p.description && <p className="hint">{p.description}</p>}
                    <PluginContents p={p} />
                    <SecretFields p={p} onSaved={setPlugins} />
                    <div className="actions">
                      {confirmRemove === p.id ? (
                        <>
                          <button
                            className="danger"
                            onClick={async () => {
                              setPlugins(await window.api.plugins.remove(p.id))
                              setConfirmRemove(null)
                            }}
                          >
                            確定移除「{p.name}」
                          </button>
                          <button className="quiet" onClick={() => setConfirmRemove(null)}>
                            取消
                          </button>
                        </>
                      ) : (
                        <button className="danger" onClick={() => setConfirmRemove(p.id)}>
                          <Icon name="trash" size={14} />
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
