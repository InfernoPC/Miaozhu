import { useEffect, useRef, useState } from 'react'
import type { McpFormInput, PluginPreview, PluginSource } from '@shared/types'

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const PASTE_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}`

/**
 * Add MCP servers without packaging a plugin: paste a config from Claude Desktop, Claude Code,
 * VS Code or a README, or fill in a form. Either way the result goes through the same review.
 */
export function McpAddDialog({ onPreview, onClose }: { onPreview: (p: PluginPreview) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'paste' | 'form'>('paste')
  const [text, setText] = useState('')
  const [form, setForm] = useState<McpFormInput>({ name: '', transport: 'stdio', command: '', args: '', env: '', url: '', headers: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  const set = (patch: Partial<McpFormInput>) => setForm((f) => ({ ...f, ...patch }))
  const ready = mode === 'paste' ? !!text.trim() : !!form.name.trim() && !!(form.transport === 'stdio' ? form.command?.trim() : form.url?.trim())

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      const source: PluginSource = mode === 'paste' ? { kind: 'mcp', text } : { kind: 'mcp-form', form }
      const preview = await window.api.plugins.inspect(source)
      if (preview) onPreview(preview)
    } catch (e) {
      setError(stripIpc(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={ref}
      className="plugin-dialog"
      aria-label="新增 MCP 伺服器"
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) void submit()
        }}
      >
        <div className="dialog-body">
          <h3>新增 MCP 伺服器</h3>
          <div className="subtabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')}>
              貼上設定
            </button>
            <button type="button" role="tab" aria-selected={mode === 'form'} className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>
              填表單
            </button>
          </div>

          {mode === 'paste' ? (
            <>
              <p className="hint">貼上 Claude Desktop、Claude Code 或 VS Code 的 MCP 設定，或伺服器說明文件裡的範例都可以。裡面的 Token、API Key 會自動移到系統鑰匙圈。</p>
              <textarea className="mcp-paste" autoFocus spellCheck={false} rows={11} value={text} placeholder={PASTE_PLACEHOLDER} onChange={(e) => setText(e.target.value)} />
            </>
          ) : (
            <div className="mcp-form">
              <label>
                <span>名稱</span>
                <input autoFocus spellCheck={false} value={form.name} placeholder="例如 github（英文、數字、- 與 _）" onChange={(e) => set({ name: e.target.value })} />
              </label>
              <div className="mcp-transport" role="radiogroup" aria-label="連線方式">
                <label className="checkbox">
                  <input type="radio" checked={form.transport === 'stdio'} onChange={() => set({ transport: 'stdio' })} />
                  在這台電腦執行指令
                </label>
                <label className="checkbox">
                  <input type="radio" checked={form.transport === 'http'} onChange={() => set({ transport: 'http' })} />
                  連到遠端網址
                </label>
              </div>
              {form.transport === 'stdio' ? (
                <>
                  <label>
                    <span>指令</span>
                    <input spellCheck={false} value={form.command} placeholder="npx -y @modelcontextprotocol/server-filesystem" onChange={(e) => set({ command: e.target.value })} />
                  </label>
                  <label>
                    <span>其他參數</span>
                    <textarea spellCheck={false} rows={2} value={form.args} placeholder={'一行一個，含空白的路徑也可以\n/Users/me/My Documents'} onChange={(e) => set({ args: e.target.value })} />
                  </label>
                  <label>
                    <span>環境變數</span>
                    <textarea spellCheck={false} rows={2} value={form.env} placeholder="KEY=value，一行一個" onChange={(e) => set({ env: e.target.value })} />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>網址</span>
                    <input spellCheck={false} value={form.url} placeholder="https://mcp.example.com/mcp" onChange={(e) => set({ url: e.target.value })} />
                  </label>
                  <label>
                    <span>標頭</span>
                    <textarea spellCheck={false} rows={2} value={form.headers} placeholder="Authorization: Bearer xxx，一行一個" onChange={(e) => set({ headers: e.target.value })} />
                  </label>
                </>
              )}
              <p className="hint">名稱含 TOKEN、KEY、SECRET、PASSWORD 的環境變數和 Authorization 標頭，會存進系統鑰匙圈，不會寫在檔案裡。</p>
            </div>
          )}
        </div>
        <div className="dialog-actions">
          {error && <p className="status err">{error}</p>}
          <button type="button" className="quiet" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? '讀取中…' : '下一步'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
