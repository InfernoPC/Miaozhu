import { useEffect, useMemo, useState } from 'react'
import { popularityLabel, sortCatalog, type CatalogSort } from '@shared/catalog-sort'
import type { MarketplaceView, PluginSource } from '@shared/types'
import { Icon } from '../common/Icon'

const stripIpc = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const PAGE = 60

export function MarketplaceBrowser({ onInspect, busy }: { onInspect: (source: PluginSource, label: string) => void; busy: boolean }) {
  const [markets, setMarkets] = useState<MarketplaceView[]>([])
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [sort, setSort] = useState<CatalogSort>('default')
  const [limit, setLimit] = useState(PAGE)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => void window.api.marketplaces.list().then(setMarkets)
    refresh()
    // Catalogs load in the background; the list updates as each one arrives.
    return window.api.plugins.onChange(refresh)
  }, [])

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matching = markets
      .filter((m) => filter === 'all' || m.name === filter)
      .flatMap((m) => m.entries.map((e) => ({ ...e, marketplace: m.name })))
      .filter((e) => !q || [e.name, e.description, e.category, e.author, ...e.tags].some((v) => v?.toLowerCase().includes(q)))
    return sortCatalog(matching, sort)
  }, [markets, query, filter, sort])
  const anyPopularity = useMemo(() => markets.some((m) => m.entries.some((e) => e.popularity)), [markets])

  const add = async () => {
    setError(null)
    setAdding(true)
    try {
      setMarkets(await window.api.marketplaces.add(input))
      setInput('')
    } catch (e) {
      setError(stripIpc(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <section>
        <h2>Marketplace</h2>
        <p className="hint">Marketplace 是外掛目錄，格式與 Claude Code 相同。可以加入公司或團隊自己的 marketplace。</p>
        <ul className="market-list">
          {markets.map((m) => (
            <li key={m.name}>
              <div className="market-info">
                <strong>{m.name}</strong>
                <span className="muted market-source">{m.source}</span>
                <span className={`market-status market-${m.status}`}>
                  {m.status === 'ready' ? `${m.entries.length} 個外掛` : m.status === 'loading' ? '下載目錄中…' : m.status === 'error' ? '無法載入' : '尚未載入'}
                </span>
              </div>
              {m.error && <pre className="mcp-error">{m.error}</pre>}
              <div className="market-actions">
                {removing === m.name ? (
                  <>
                    <button className="danger" onClick={async () => (setMarkets(await window.api.marketplaces.remove(m.name, true)), setRemoving(null))}>
                      移除，也解除安裝它的外掛
                    </button>
                    <button onClick={async () => (setMarkets(await window.api.marketplaces.remove(m.name, false)), setRemoving(null))}>只移除目錄</button>
                    <button className="quiet" onClick={() => setRemoving(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button className="quiet" disabled={m.status === 'loading'} onClick={async () => setMarkets(await window.api.marketplaces.refresh(m.name))}>
                      重新整理
                    </button>
                    <button className="quiet" aria-label={`移除 ${m.name}`} onClick={() => setRemoving(m.name)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
          {markets.length === 0 && <li className="hint">還沒有加入任何 marketplace。</li>}
        </ul>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) void add()
          }}
        >
          <input value={input} spellCheck={false} placeholder="owner/repo、Git 網址、marketplace.json 網址或資料夾路徑" onChange={(e) => setInput(e.target.value)} />
          <button type="submit" disabled={adding || !input.trim()}>
            {adding ? '加入中…' : '加入'}
          </button>
        </form>
        {error && <p className="status err">{error}</p>}
      </section>

      <section>
        <div className="row browse-filters">
          <input type="search" value={query} placeholder="搜尋外掛名稱、說明、分類" onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))} />
          <select value={filter} aria-label="篩選 marketplace" onChange={(e) => (setFilter(e.target.value), setLimit(PAGE))}>
            <option value="all">全部 marketplace</option>
            {markets.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <select value={sort} aria-label="排序" onChange={(e) => (setSort(e.target.value as CatalogSort), setLimit(PAGE))}>
            <option value="default">預設排序</option>
            <option value="popular">熱門</option>
            <option value="name">名稱</option>
          </select>
        </div>
        {sort === 'popular' && !anyPopularity && (
          <p className="hint">這些 marketplace 沒有提供安裝數，排序維持原本順序。marketplace 可以在外掛項目的 metadata.installs 提供數字。</p>
        )}
        <ul className="catalog">
          {entries.slice(0, limit).map((e) => (
            <li key={`${e.marketplace}/${e.name}`} className={e.supported ? '' : 'entry-unsupported'}>
              <div className="entry-main">
                <div className="entry-title">
                  <strong>{e.name}</strong>
                  {e.version && <span className="muted">{e.version}</span>}
                  {e.installed?.updateAvailable ? (
                    <span className="entry-badge badge-update">有更新</span>
                  ) : e.installed ? (
                    <span className="entry-badge">已安裝</span>
                  ) : null}
                  {!e.supported && <span className="entry-badge badge-off">不支援</span>}
                </div>
                {e.description && <p className="entry-desc">{e.description}</p>}
                <p className="entry-meta">
                  {[e.popularity ? popularityLabel(e.popularity) : null, e.author, e.category, filter === 'all' ? e.marketplace : null].filter(Boolean).join('，')}
                  {!e.supported && `（${e.sourceLabel}）`}
                </p>
              </div>
              <button
                className={e.installed?.updateAvailable ? 'primary' : ''}
                disabled={busy || !e.supported || (!!e.installed && !e.installed.updateAvailable)}
                onClick={() => onInspect({ kind: 'marketplace', marketplace: e.marketplace, entry: e.name }, `下載「${e.name}」中…`)}
              >
                {e.installed?.updateAvailable ? '更新' : e.installed ? '已安裝' : '安裝'}
              </button>
            </li>
          ))}
        </ul>
        {entries.length === 0 && markets.some((m) => m.status === 'ready') && <p className="hint">沒有符合的外掛。</p>}
        {entries.length > limit && (
          <button className="quiet" onClick={() => setLimit(limit + PAGE)}>
            顯示更多（還有 {entries.length - limit} 個）
          </button>
        )}
      </section>
    </>
  )
}
