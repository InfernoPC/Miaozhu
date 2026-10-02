import { useEffect, useRef, useState } from 'react'
import type { PluginMcpView, PluginPreview, PluginSource, PluginView, ToolRisk } from '@shared/types'
import { Icon } from '../common/Icon'
import { MarketplaceBrowser } from './MarketplaceBrowser'
import { McpAddDialog } from './McpAddDialog'

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

/** Where an install stands; the dialog shows one step at a time. */
type Review =
  | { step: 'loading'; label: string }
  | { step: 'confirm' | 'installing'; preview: PluginPreview; error?: string }
  | { step: 'done'; plugin: PluginView }
  | { step: 'failed'; error: string }

/**
 * Install review as a modal, so it shows wherever the user clicked "安裝" (the marketplace
 * list can be long) and nothing behind it can be clicked meanwhile. Esc cancels.
 */
function ReviewDialog({ review, onInstall, onClose, onShow }: { review: Review; onInstall: () => void; onClose: () => void; onShow: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  const working = review.step === 'loading' || review.step === 'installing'
  const preview = review.step === 'confirm' || review.step === 'installing' ? review.preview : null
  const missingSecrets = review.step === 'done' ? review.plugin.secrets.filter((s) => !s.isSet).length : 0

  return (
    <dialog
      ref={ref}
      className="plugin-dialog"
      aria-label="安裝外掛"
      onCancel={(e) => {
        e.preventDefault()
        if (!working) onClose()
      }}
    >
      {review.step === 'loading' && (
        <div className="dialog-body dialog-center">
          <Icon name="gear" size={18} className="spin" />
          <p>{review.label}</p>
        </div>
      )}

      {preview && (
        <>
          <div className="dialog-body">
            <h3>
              {preview.plugin.name}
              {preview.plugin.version && <span className="muted"> {preview.plugin.version}</span>}
            </h3>
            {preview.plugin.description && <p className="hint">{preview.plugin.description}</p>}
            {preview.replaces && <p className="status err">會取代已安裝的「{preview.replaces}」</p>}
            {preview.movedSecrets && (
              <p className="hint">
                <Icon name="lock" size={13} /> 已把 {preview.movedSecrets.join('、')} 從設定中移出，安裝時會存進系統鑰匙圈。
              </p>
            )}
            {preview.plugin.secrets.some((x) => !x.isSet) && (
              <p className="hint">
                安裝後還要填密鑰：
                {preview.plugin.secrets
                  .filter((x) => !x.isSet)
                  .map((x) => x.name)
                  .join('、')}
              </p>
            )}
            <p className="hint">請確認下列內容。MCP 伺服器會在你的電腦上執行下面列出的指令；之後每次使用工具時，仍會依風險等級先問你。</p>
            <PluginContents p={preview.plugin} preview />
          </div>
          <div className="dialog-actions">
            {review.step === 'confirm' && review.error && <p className="status err">{review.error}</p>}
            <button className="quiet" disabled={working} onClick={onClose}>
              取消
            </button>
            <button className="primary" autoFocus disabled={working} onClick={onInstall}>
              {review.step === 'installing' ? '安裝中…' : preview.replaces ? '取代並安裝' : '安裝'}
            </button>
          </div>
        </>
      )}

      {review.step === 'done' && (
        <>
          <div className="dialog-body">
            <h3>已安裝「{review.plugin.name}」</h3>
            <p className="hint">
              {missingSecrets > 0 ? `還需要填 ${missingSecrets} 個密鑰才能使用，到「已安裝」分頁設定。` : '現在就可以在對話裡使用了。'}
            </p>
          </div>
          <div className="dialog-actions">
            <button className={missingSecrets ? 'quiet' : 'primary'} autoFocus={!missingSecrets} onClick={onClose}>
              繼續逛
            </button>
            <button className={missingSecrets ? 'primary' : ''} autoFocus={missingSecrets > 0} onClick={() => onShow(review.plugin.id)}>
              {missingSecrets ? '去設定密鑰' : '查看外掛'}
            </button>
          </div>
        </>
      )}

      {review.step === 'failed' && (
        <>
          <div className="dialog-body">
            <h3>沒辦法安裝</h3>
            <pre className="mcp-error">{review.error}</pre>
          </div>
          <div className="dialog-actions">
            <button className="primary" autoFocus onClick={onClose}>
              關閉
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}

export function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginView[]>([])
  const [review, setReview] = useState<Review | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [view, setView] = useState<'installed' | 'browse'>('installed')
  const [addingMcp, setAddingMcp] = useState(false)

  useEffect(() => {
    const refresh = () => void window.api.plugins.list().then(setPlugins)
    refresh()
    return window.api.plugins.onChange(refresh)
  }, [])

  const busy = !!review && review.step !== 'done' && review.step !== 'failed'

  const inspect = async (source: PluginSource, label: string) => {
    setReview({ step: 'loading', label })
    try {
      const preview = await window.api.plugins.inspect(source)
      // null: the user closed the file picker.
      setReview(preview ? { step: 'confirm', preview } : null)
    } catch (e) {
      setReview({ step: 'failed', error: stripIpc(e) })
    }
  }

  const install = async () => {
    if (review?.step !== 'confirm') return
    const { preview } = review
    setReview({ step: 'installing', preview })
    try {
      const list = await window.api.plugins.install(preview.stagingId)
      setPlugins(list)
      setGitUrl('')
      setReview({ step: 'done', plugin: list.find((p) => p.id === preview.plugin.id) ?? preview.plugin })
    } catch (e) {
      setReview({ step: 'confirm', preview, error: stripIpc(e) })
    }
  }

  const closeReview = () => {
    if (review?.step === 'confirm') void window.api.plugins.cancelInstall(review.preview.stagingId)
    setReview(null)
  }

  return (
    <div className="settings-page">
      <div className="subtabs" role="tablist">
        <button role="tab" aria-selected={view === 'installed'} className={view === 'installed' ? 'active' : ''} onClick={() => setView('installed')}>
          已安裝{plugins.length ? ` ${plugins.length}` : ''}
        </button>
        <button role="tab" aria-selected={view === 'browse'} className={view === 'browse' ? 'active' : ''} onClick={() => setView('browse')}>
          探索市集
        </button>
      </div>

      {view === 'installed' && (
      <section>
        <h2>外掛</h2>
        <p className="hint">
          外掛可以幫喵助加上技能（工作流程、公司知識）、MCP 伺服器與自訂工具，格式與 Claude Code 外掛相容。安裝前會先列出它會加入的所有東西讓你確認。
        </p>
        <div className="actions">
          <button disabled={busy} onClick={() => inspect({ kind: 'folder' }, '讀取資料夾…')}>
            <Icon name="folder" size={15} />
            從資料夾安裝
          </button>
          <button disabled={busy} onClick={() => inspect({ kind: 'zip' }, '解壓縮中…')}>
            <Icon name="file" size={15} />
            從 zip 安裝
          </button>
          <button disabled={busy} onClick={() => setAddingMcp(true)}>
            <Icon name="plus" size={15} />
            新增 MCP 伺服器
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
          <button type="submit" disabled={busy || !gitUrl.trim()}>
            讀取
          </button>
        </form>
      </section>
      )}

      {addingMcp && (
        <McpAddDialog
          onClose={() => setAddingMcp(false)}
          onPreview={(preview) => {
            setAddingMcp(false)
            setReview({ step: 'confirm', preview })
          }}
        />
      )}

      {review && (
        <ReviewDialog
          review={review}
          onInstall={() => void install()}
          onClose={closeReview}
          onShow={(id) => {
            setReview(null)
            setView('installed')
            setOpen(id)
          }}
        />
      )}

      {view === 'browse' && <MarketplaceBrowser busy={busy} onInspect={(source, label) => void inspect(source, label)} />}

      {view === 'installed' && (
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
                    {p.origin && (
                      <p className="hint">
                        來自 marketplace「{p.origin.marketplace}」{p.origin.version ? `，版本 ${p.origin.version}` : ''}
                      </p>
                    )}
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
      )}
    </div>
  )
}
