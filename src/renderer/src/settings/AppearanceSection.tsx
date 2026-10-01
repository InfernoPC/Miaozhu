import { useEffect, useState } from 'react'
import type { SkinView } from '@shared/types'
import { Icon } from '../common/Icon'

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Pick the desktop character; install designer-made skin packs (Lottie or images). */
export function AppearanceSection() {
  const [skins, setSkins] = useState<SkinView[]>([])
  const [current, setCurrent] = useState('desk')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  useEffect(() => {
    void window.api.skins.list().then(setSkins)
    void window.api.settings.get().then((v) => setCurrent(v.petSkin))
  }, [])

  const install = async (from: 'folder' | 'zip') => {
    setError(null)
    try {
      const list = await window.api.skins.install(from)
      if (list) {
        setSkins(list)
        setCurrent((await window.api.settings.get()).petSkin)
      }
    } catch (e) {
      setError(stripIpc(e))
    }
  }

  return (
    <section>
      <h2>外觀</h2>
      <p className="hint">選擇桌面上的角色。設計師可以用 Lottie 動畫或每個狀態一張圖片做成造型包，格式見專案裡的 skins/README.md。</p>
      <ul className="folder-list">
        {skins.map((s) => (
          <li key={s.id}>
            <label className="folder-path skin-row">
              <input
                type="radio"
                name="skin"
                checked={s.id === current}
                onChange={async () => {
                  await window.api.skins.select(s.id)
                  setCurrent(s.id)
                }}
              />
              <strong>{s.name}</strong>
              <span className="muted">
                {s.builtin ? '內建' : [s.author, s.renderer === 'lottie' ? 'Lottie 動畫' : '圖片', `${s.states?.length ?? 0} 個狀態`].filter(Boolean).join('，')}
              </span>
            </label>
            {!s.builtin &&
              (confirm === s.id ? (
                <>
                  <button className="danger" onClick={async () => (setSkins(await window.api.skins.remove(s.id)), setConfirm(null), setCurrent((await window.api.settings.get()).petSkin))}>
                    確定移除
                  </button>
                  <button className="quiet" onClick={() => setConfirm(null)}>
                    取消
                  </button>
                </>
              ) : (
                <button className="quiet" aria-label={`移除 ${s.name}`} onClick={() => setConfirm(s.id)}>
                  <Icon name="trash" size={14} />
                </button>
              ))}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button onClick={() => install('folder')}>
          <Icon name="folder" size={15} />
          從資料夾安裝造型
        </button>
        <button onClick={() => install('zip')}>
          <Icon name="file" size={15} />
          從 zip 安裝
        </button>
      </div>
      {error && <p className="status err">{error}</p>}
    </section>
  )
}
