import { useEffect, useState } from 'react'
import type { GalleryTagStatus, SettingsView } from '@shared/types'
import { Icon } from '../common/Icon'

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function GalleryTab() {
  const [view, setView] = useState<SettingsView | null>(null)
  const [status, setStatus] = useState<GalleryTagStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setView)
    void window.api.gallery.tagStatus().then(setStatus)
    const off = [window.api.gallery.onTagStatus(setStatus), window.api.gallery.onChange(() => void window.api.gallery.tagStatus().then(setStatus))]
    return () => off.forEach((f) => f())
  }, [])
  if (!view) return null

  const choose = async () => {
    setError(null)
    try {
      setView(await window.api.settings.chooseGalleryFolder())
    } catch (e) {
      setError(stripIpc(e))
    }
  }
  const tagging = (autoTag: boolean, profileId: string | null) => void window.api.settings.setGalleryTagging(autoTag, profileId).then(setView)
  const profile = view.profiles.find((p) => p.id === view.galleryTagProfileId) ?? view.profiles.find((p) => p.id === view.activeProfileId)

  return (
    <div className="settings-page">
      <section>
        <h2>梗圖庫</h2>
        <p className="hint">把常用的梗圖、貼圖放在這裡，點一下就複製，可以直接貼到 LINE、Teams。從貓咪的右鍵選單「梗圖庫」打開。</p>
        <div className="actions">
          <button className="primary" onClick={() => window.api.windows.openGallery()}>
            開啟梗圖庫
          </button>
        </div>
      </section>

      <section>
        <h2>圖庫資料夾</h2>
        <ul className="folder-list">
          <li>
            <span className="folder-path">
              <Icon name="folder" size={16} />
              {view.galleryFolder}
            </span>
            <button onClick={() => void window.api.gallery.openFolder('')}>開啟</button>
          </li>
        </ul>
        <div className="actions">
          <button onClick={choose}>變更…</button>
          {!view.galleryFolderIsDefault && <button onClick={async () => setView(await window.api.settings.resetGalleryFolder())}>恢復預設</button>}
        </div>
        <p className="hint">可以直接指到已經整理好的資料夾，例如 meme_gallery 的 img 資料夾。子資料夾會成為分類。</p>
        {error && <p className="status err">{error}</p>}
      </section>

      <section>
        <h2>自動加標籤</h2>
        <p className="hint">
          讓 AI 看過每張圖，寫下描述、關鍵字（例如「謝謝」「辛苦了」）和圖中文字，之後就能用這些字搜尋。每張圖只會看一次，但會用到模型額度；需要支援看圖的模型。
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={view.galleryAutoTag} onChange={(e) => tagging(e.target.checked, view.galleryTagProfileId)} />
          新增圖片時自動加標籤
        </label>
        <label className="field">
          <span>使用的模型</span>
          <select value={view.galleryTagProfileId ?? ''} onChange={(e) => tagging(view.galleryAutoTag, e.target.value || null)}>
            <option value="">目前使用的模型連線</option>
            {view.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.model}）{p.isLocal ? '・本機' : ''}
              </option>
            ))}
          </select>
          <small>{profile ? `會用「${profile.name}」的 ${profile.model}。` : '還沒有模型連線，請先到「模型連線」新增。'}標籤存在圖庫資料夾的 .miaozhu 裡，圖庫搬到別台電腦也會跟著。</small>
        </label>
        {status && (
          <p className={`status ${status.state === 'error' ? 'err' : ''}`}>
            {status.state === 'running'
              ? `加標籤中… ${status.done}/${status.total}`
              : status.message
                ? status.message
                : `已加標籤 ${status.tagged}／${status.images} 張`}
          </p>
        )}
        <div className="actions">
          {status?.state === 'running' ? (
            <button onClick={() => void window.api.gallery.stopTagging()}>停止</button>
          ) : (
            <button disabled={!profile || (status ? status.tagged >= status.images : false)} onClick={() => void window.api.gallery.tag()}>
              <Icon name="tag" size={15} />
              為還沒加標籤的圖加標籤
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
