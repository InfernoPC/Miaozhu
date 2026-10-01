import { describe, expect, it } from 'vitest'
import { popularityLabel, sortCatalog } from '../src/shared/catalog-sort'
import type { MarketplaceEntryView } from '../src/shared/types'
import { parseCatalog } from '../src/main/plugins/marketplace'

const entry = (name: string, extra: Partial<MarketplaceEntryView> = {}): MarketplaceEntryView => ({ name, tags: [], sourceLabel: '', supported: true, ...extra })

describe('popularity from the catalog', () => {
  it('reads installs, downloads or a score from entry metadata, and ignores junk', () => {
    const c = parseCatalog({
      name: 'm',
      owner: { name: 'o' },
      plugins: [
        { name: 'a', source: './a', metadata: { installs: 1200 } },
        { name: 'b', source: './b', metadata: { downloads: '35' } },
        { name: 'c', source: './c', metadata: { popularity: 7 } },
        { name: 'd', source: './d', metadata: { installs: -3 } },
        { name: 'e', source: './e', metadata: { installs: 'lots' } },
        { name: 'f', source: './f' }
      ]
    })
    expect(c.entries.map((e) => e.popularity)).toEqual([
      { value: 1200, kind: 'installs' },
      { value: 35, kind: 'downloads' },
      { value: 7, kind: 'score' },
      undefined,
      undefined,
      undefined
    ])
  })
})

describe('sortCatalog', () => {
  const list = [
    entry('cherry', { popularity: { value: 10, kind: 'installs' } }),
    entry('apple'),
    entry('banana', { popularity: { value: 300, kind: 'installs' } }),
    entry('date', { popularity: { value: 10, kind: 'installs' } }),
    entry('elder', { supported: false }),
    entry('fig', { installed: { pluginId: 'fig', updateAvailable: true } })
  ]
  const names = (xs: MarketplaceEntryView[]) => xs.map((x) => x.name)

  it('popular: highest first, ties and unranked keep catalog order', () => {
    expect(names(sortCatalog(list, 'popular'))).toEqual(['banana', 'cherry', 'date', 'apple', 'elder', 'fig'])
  })

  it('name: alphabetical', () => {
    expect(names(sortCatalog(list, 'name'))).toEqual(['apple', 'banana', 'cherry', 'date', 'elder', 'fig'])
  })

  it('default: updates first, unsupported last, otherwise catalog order', () => {
    expect(names(sortCatalog(list, 'default'))).toEqual(['fig', 'cherry', 'apple', 'banana', 'date', 'elder'])
  })

  it('does not reorder the input array', () => {
    sortCatalog(list, 'name')
    expect(names(list)[0]).toBe('cherry')
  })

  it('labels the number by what it counts', () => {
    expect(popularityLabel({ value: 12345, kind: 'installs' })).toBe('12,345 次安裝')
    expect(popularityLabel({ value: 8, kind: 'downloads' })).toBe('8 次下載')
    expect(popularityLabel({ value: 92, kind: 'score' })).toBe('熱門度 92')
  })
})
