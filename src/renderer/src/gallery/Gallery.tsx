import { useCallback, useEffect, useRef, useState } from 'react'
import type { GalleryFolderView, GalleryImageView, GalleryListing, GalleryTagStatus } from '@shared/types'
import { droppedPaths } from '../common/AttachmentChips'
import { Icon } from '../common/Icon'
import { LineDialog } from './LineDialog'
import './gallery.css'

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
/** Gallery images load over the app's own protocol, which only serves files inside the gallery. */
const src = (rel: string, v?: number) => `miaozhu-gallery://img/${rel.split('/').map(encodeURIComponent).join('/')}${v ? `?v=${v}` : ''}`
const parentOf = (rel: string) => rel.split('/').slice(0, -1).join('/')

/** A path dropped on the window → its place in the gallery, or null when it's from outside. */
function relInside(root: string, path: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  const same = navigator.userAgent.includes('Windows') ? p.toLowerCase().startsWith(`${r.toLowerCase()}/`) : p.startsWith(`${r}/`)
  return same ? p.slice(r.length + 1) : null
}

/** A small modal asking for a name (new folder, rename). */
function NameDialog({ title, initial, onDone }: { title: string; initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])
  return (
    <dialog ref={ref} className="name-dialog" onCancel={(e) => (e.preventDefault(), onDone(null))}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onDone(value.trim())
        }}
      >
        <h3>{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            // Select the name without the extension, like Finder.
            const dot = e.target.value.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
          }}
        />
        <div className="name-actions">
          <button type="button" className="quiet" onClick={() => onDone(null)}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            確定
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function Gallery() {
  const [rel, setRel] = useState('')
  const [listing, setListing] = useState<GalleryListing | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GalleryImageView[] | null>(null)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [tagStatus, setTagStatus] = useState<GalleryTagStatus | null>(null)
  const [naming, setNaming] = useState<{ title: string; initial: string; done: (name: string) => Promise<unknown> } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [lineOpen, setLineOpen] = useState(false)
  const toastTimer = useRef<number | undefined>(undefined)

  const say = (text: string, error = false) => {
    window.clearTimeout(toastTimer.current)
    setToast({ text, error })
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 4000 : 1600)
  }
  const attempt = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) say(done)
    } catch (e) {
      say(stripIpc(e), true)
    }
  }

  const load = useCallback(async (target: string) => {
    try {
      setListing(await window.api.gallery.list(target))
      setRel(target)
    } catch (e) {
      // The folder vanished (renamed elsewhere): fall back to the top.
      if (target) return load('')
      say(stripIpc(e), true)
    }
  }, [])

  useEffect(() => {
    void load('')
    void window.api.gallery.tagStatus().then(setTagStatus)
    const offTags = window.api.gallery.onTagStatus(setTagStatus)
    return offTags
  }, [load])

  // Changes from this window, other windows or Finder / Explorer.
  const relRef = useRef(rel)
  relRef.current = rel
  const queryRef = useRef(query)
  queryRef.current = query
  useEffect(
    () =>
      window.api.gallery.onChange(() => {
        void load(relRef.current)
        if (queryRef.current.trim()) void window.api.gallery.search(queryRef.current).then(setResults)
      }),
    [load]
  )

  useEffect(() => {
    if (!query.trim()) return setResults(null)
    const t = window.setTimeout(() => void window.api.gallery.search(query).then(setResults), 150)
    return () => window.clearTimeout(t)
  }, [query])

  // ⌘V / Ctrl+V outside a text field saves the clipboard's image here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && !typing) {
        e.preventDefault()
        void paste()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const copy = (img: GalleryImageView) =>
    attempt(async () => {
      const as = await window.api.gallery.copy(img.rel)
      say(as === 'file' ? '已複製（動圖以檔案複製，貼上後會動）' : '已複製')
    })

  const paste = () =>
    attempt(async () => {
      const saved = await window.api.gallery.paste(rel)
      say(saved ? '已貼上' : '剪貼簿裡沒有圖片', !saved)
    })

  const rename = (target: string, name: string) =>
    setNaming({ title: '重新命名', initial: name, done: (next) => window.api.gallery.rename(target, next) })

  const onMenu = async (target: string, kind: 'image' | 'folder', img?: GalleryImageView) => {
    const picked = await window.api.gallery.menu(target, kind)
    if (!picked) return
    const name = target.split('/').pop() ?? target
    switch (picked.action) {
      case 'copy':
        return img && copy(img)
      case 'open':
        return kind === 'folder' ? load(target) : attempt(() => window.api.gallery.open(target))
      case 'reveal':
        return attempt(() => window.api.gallery.reveal(target))
      case 'rename':
        return rename(target, name)
      case 'move':
        return attempt(() => window.api.gallery.move(target, picked.to), `已搬到「${picked.to || '梗圖庫'}」`)
      case 'delete':
        return attempt(() => window.api.gallery.remove(target), `已把「${name}」丟到垃圾桶`)
      case 'retag':
        return attempt(() => window.api.gallery.tag([target]), '重新產生標籤中…')
    }
  }

  /** Files dropped on a folder (or the window): ours are moved, others copied in. */
  const onDrop = async (e: React.DragEvent, toFolder: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    if (!listing) return
    const paths = droppedPaths(e)
    const outside: string[] = []
    let moved = 0
    for (const p of paths) {
      const inside = relInside(listing.root, p)
      if (inside === null) outside.push(p)
      else if (inside !== toFolder && parentOf(inside) !== toFolder) {
        await attempt(() => window.api.gallery.move(inside, toFolder))
        moved++
      }
    }
    if (outside.length) {
      await attempt(async () => {
        const n = await window.api.gallery.importFiles(outside, toFolder)
        say(n ? `已加入 ${n} 張圖片` : '沒有可以加入的圖片（支援 PNG、JPG、GIF、APNG、WebP）', !n)
      })
    } else if (moved) say(`已搬到「${toFolder || '梗圖庫'}」`)
  }

  const crumbs = rel ? rel.split('/') : []
  const folders = results ? [] : (listing?.folders ?? [])
  const images = results ?? listing?.images ?? []
  const empty = listing && !results && !folders.length && !images.length

  const folderTile = (f: GalleryFolderView) => (
    <div
      key={f.rel}
      className={`tile folder ${dropTarget === f.rel ? 'drop' : ''}`}
      title={f.name}
      draggable
      onDragStart={(e) => {
        e.preventDefault()
        window.api.gallery.startDrag(f.rel)
      }}
      onClick={() => void load(f.rel)}
      onContextMenu={(e) => (e.preventDefault(), void onMenu(f.rel, 'folder'))}
      onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setDropTarget(f.rel))}
      onDragLeave={() => setDropTarget((t) => (t === f.rel ? null : t))}
      onDrop={(e) => void onDrop(e, f.rel)}
    >
      <div className="thumb folder-thumb">
        {f.cover ? <img src={src(f.cover)} alt="" loading="lazy" draggable={false} /> : <Icon name="folder" size={40} />}
        <span className="folder-badge">
          <Icon name="folder" size={13} /> {f.imageCount}
        </span>
      </div>
      <div className="tile-name">{f.name}</div>
    </div>
  )

  const imageTile = (img: GalleryImageView) => (
    <div
      key={img.rel}
      className="tile"
      title={[img.name, img.description, img.tags?.length ? `#${img.tags.join(' #')}` : ''].filter(Boolean).join('\n')}
      draggable
      onDragStart={(e) => {
        // A real file drag, so it can be dropped into LINE, Teams, Finder…
        e.preventDefault()
        window.api.gallery.startDrag(img.rel)
      }}
      onClick={() => void copy(img)}
      onContextMenu={(e) => (e.preventDefault(), void onMenu(img.rel, 'image', img))}
    >
      <div className="thumb">
        <img src={src(img.rel, img.mtime)} alt={img.name} loading="lazy" draggable={false} />
        {img.animated && <span className="anim-badge">GIF</span>}
      </div>
      <div className="tile-name">{img.name}</div>
      {results && parentOf(img.rel) && <div className="tile-path">{parentOf(img.rel)}</div>}
    </div>
  )

  return (
    <div
      className={`gallery ${dropTarget === '' ? 'drop' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setDropTarget(''))}
      onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)}
      onDrop={(e) => void onDrop(e, rel)}
    >
      <header className="gallery-head">
        <nav className="crumbs" aria-label="位置">
          <button className={`quiet crumb ${crumbs.length ? '' : 'current'}`} onClick={() => (setQuery(''), void load(''))}>
            梗圖庫
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="crumb-wrap">
              <span className="crumb-sep">/</span>
              <button className={`quiet crumb ${i === crumbs.length - 1 ? 'current' : ''}`} onClick={() => (setQuery(''), void load(crumbs.slice(0, i + 1).join('/')))}>
                {c}
              </button>
            </span>
          ))}
        </nav>
        <label className="search">
          <Icon name="search" size={15} />
          <input type="search" value={query} placeholder="搜尋檔名、資料夾或標籤" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="head-actions">
          <button
            className="quiet"
            title="新資料夾"
            onClick={() => setNaming({ title: '新資料夾', initial: '', done: (name) => window.api.gallery.mkdir(rel, name) })}
          >
            <Icon name="plus" size={16} /> 資料夾
          </button>
          <button className="quiet" title="貼上 LINE 貼圖網址，整組下載" onClick={() => setLineOpen(true)}>
            <Icon name="paw" size={16} /> LINE 貼圖
          </button>
          <button className="quiet" title="把剪貼簿的圖貼到這裡（⌘V / Ctrl+V）" onClick={() => void paste()}>
            <Icon name="clipboard" size={16} /> 貼上
          </button>
          <button className="quiet" title={navigator.userAgent.includes('Windows') ? '在檔案總管中開啟' : '在 Finder 中開啟'} onClick={() => void window.api.gallery.openFolder(rel)}>
            <Icon name="folder" size={16} />
          </button>
        </div>
      </header>

      {tagStatus?.state === 'running' && (
        <div className="tag-bar">
          <Icon name="tag" size={14} /> 自動加標籤中 {tagStatus.done}/{tagStatus.total}
          <progress max={tagStatus.total} value={tagStatus.done} />
          <button className="quiet" onClick={() => void window.api.gallery.stopTagging()}>
            停止
          </button>
        </div>
      )}
      {tagStatus?.state === 'error' && tagStatus.message && <div className="tag-bar error">{tagStatus.message}</div>}

      <main className="gallery-body">
        {rel && !results && (
          <button className="quiet up" onClick={() => void load(parentOf(rel))}>
            <Icon name="up" size={14} /> 回上層
          </button>
        )}
        {results && <p className="hint">{results.length ? `找到 ${results.length} 張` : '沒有符合的圖片。還沒加標籤的圖只能用檔名或資料夾名稱找到。'}</p>}
        {empty && (
          <div className="gallery-empty">
            <p className="empty-title">這裡還沒有圖</p>
            <p className="hint">把圖片拖進來，或複製圖片後按 ⌘V／Ctrl+V 貼上。點一下圖片就會複製，可以直接貼到 LINE、Teams。</p>
            <p className="hint">已經有整理好的圖庫？到「設定 → 梗圖庫」把資料夾指過去。</p>
            <button onClick={() => window.api.windows.openSettings()}>開啟設定</button>
          </div>
        )}
        <div className="grid">
          {folders.map(folderTile)}
          {images.map(imageTile)}
        </div>
      </main>

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div>}
      {lineOpen && (
        <LineDialog
          folder={rel}
          onClose={() => setLineOpen(false)}
          onDone={(target) => {
            setLineOpen(false)
            setQuery('')
            void load(target)
          }}
        />
      )}
      {naming && (
        <NameDialog
          title={naming.title}
          initial={naming.initial}
          onDone={(name) => {
            const n = naming
            setNaming(null)
            if (name) void attempt(() => n.done(name))
          }}
        />
      )}
    </div>
  )
}
