import type { MarketplaceEntryView } from './types'

export type CatalogSort = 'default' | 'popular' | 'name'

/**
 * - default: plugins with an update first, then installable ones, otherwise catalog order
 * - popular: by the marketplace's own popularity number, highest first; entries without one
 *   keep their catalog order after all ranked ones
 * - name: alphabetical
 * Stable, so ties keep the marketplace's own order.
 */
export function sortCatalog<T extends MarketplaceEntryView>(entries: T[], sort: CatalogSort): T[] {
  const indexed = entries.map((e, i) => ({ e, i }))
  const by = (cmp: (a: T, b: T) => number) => indexed.sort((a, b) => cmp(a.e, b.e) || a.i - b.i).map((x) => x.e)
  switch (sort) {
    case 'popular':
      return by((a, b) => (b.popularity?.value ?? -1) - (a.popularity?.value ?? -1))
    case 'name':
      return by((a, b) => a.name.localeCompare(b.name))
    default:
      return by((a, b) => Number(!!b.installed?.updateAvailable) - Number(!!a.installed?.updateAvailable) || Number(b.supported) - Number(a.supported))
  }
}

const LABEL = { installs: '次安裝', downloads: '次下載', score: '熱門度' } as const

export function popularityLabel(p: NonNullable<MarketplaceEntryView['popularity']>): string {
  const n = p.value.toLocaleString('zh-TW')
  return p.kind === 'score' ? `${LABEL.score} ${n}` : `${n} ${LABEL[p.kind]}`
}
