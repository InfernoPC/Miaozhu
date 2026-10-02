import { useEffect, useRef, useState } from 'react'

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Paste a LINE sticker link; the set lands in a new folder under the current one. */
export function LineDialog({ folder, onClose, onDone }: { folder: string; onClose: () => void; onDone: (rel: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; title: string } | null>(null)
  const [result, setResult] = useState<{ rel: string; title: string; saved: number; skipped: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
    return window.api.gallery.onLineProgress(setProgress)
  }, [])

  const start = async () => {
    setError(null)
    setResult(null)
    setProgress(null)
    setBusy(true)
    try {
      setResult(await window.api.gallery.lineDownload(url, folder))
    } catch (e) {
      setError(stripIpc(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="name-dialog line-dialog" onCancel={(e) => (e.preventDefault(), !busy && onClose())}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim() && !busy) void start()
        }}
      >
        <h3>下載 LINE 貼圖</h3>
        <input autoFocus spellCheck={false} value={url} placeholder="https://store.line.me/stickershop/product/…" onChange={(e) => setUrl(e.target.value)} disabled={busy} />
        <p className="hint">整組下載到「{folder || '梗圖庫'}」裡的新資料夾；動態貼圖會保留動畫。已經下載過的會略過。</p>

        {progress && !result && (
          <div className="line-progress">
            <span>{progress.title}</span>
            <progress max={progress.total} value={progress.done} />
            <span>
              {progress.done}/{progress.total}
            </span>
          </div>
        )}
        {result && (
          <p className="status ok">
            「{result.title}」已下載 {result.saved} 張{result.skipped ? `，${result.skipped} 張原本就有` : ''}
            {result.failed ? `，${result.failed} 張下載失敗` : ''}
          </p>
        )}
        {error && <p className="status err">{error}</p>}
        <p className="disclaimer">貼圖的著作權屬於原作者與 LINE，下載僅供個人使用，請勿用於商業用途或再散布。</p>

        <div className="name-actions">
          {result ? (
            <>
              <button type="button" className="quiet" onClick={onClose}>
                關閉
              </button>
              <button type="button" className="primary" onClick={() => onDone(result.rel)}>
                打開資料夾
              </button>
            </>
          ) : (
            <>
              <button type="button" className="quiet" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="primary" disabled={busy || !url.trim()}>
                {busy ? '下載中…' : '下載'}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  )
}
