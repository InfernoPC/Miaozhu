import { app } from 'electron'
import { join } from 'node:path'
import type { MarketplaceEntryView, MarketplaceView, PluginView } from '@shared/types'
import { readJson, writeJson } from '../util/json-file'
import {
  describeEntrySource,
  describeSource,
  fetchEntry,
  fetchMarketplace,
  parseMarketplaceInput,
  type CatalogEntry,
  type FetchedMarketplace,
  type FetchPolicy,
  type MarketplaceSource
} from './marketplace'

/** Added on first launch so the catalog isn't empty; users can remove it. */
export const DEFAULT_MARKETPLACE = { name: 'claude-plugins-official', source: { kind: 'github', repo: 'anthropics/claude-plugins-official' } as MarketplaceSource }

interface Saved {
  name: string
  source: MarketplaceSource
  isDefault?: boolean
  updatedAt?: string
}

interface StateFile {
  /** False until the default marketplace has been offered once (removing it then sticks). */
  initialized: boolean
  items: Saved[]
}

const statePath = () => join(app.getPath('userData'), 'marketplaces.json')
const cacheDir = () => join(app.getPath('userData'), 'marketplace-cache')

type Loaded = { status: 'ready'; data: FetchedMarketplace } | { status: 'loading' } | { status: 'error'; error: string }

/**
 * The marketplaces a user has added. Catalogs are fetched lazily (first time the user opens
 * the marketplace list, or on refresh), never at app start, so a slow network can't delay launch.
 */
export class MarketplaceManager {
  private state: StateFile
  private loaded = new Map<string, Loaded>()

  constructor(
    private policy: FetchPolicy = {},
    private onChange: () => void = () => {}
  ) {
    this.state = readJson<StateFile>(statePath(), { initialized: false, items: [] })
    if (!this.state.initialized) {
      this.state = { initialized: true, items: [{ ...DEFAULT_MARKETPLACE, isDefault: true }] }
      this.save()
    }
  }

  /** Views with install/update status relative to the installed plugins. */
  list(installed: PluginView[]): MarketplaceView[] {
    return this.state.items.map((m) => {
      const l = this.loaded.get(m.name)
      const data = l?.status === 'ready' ? l.data : undefined
      return {
        name: m.name,
        description: data?.catalog.description,
        owner: data?.catalog.owner,
        source: describeSource(m.source),
        isDefault: !!m.isDefault,
        status: l?.status ?? 'not-loaded',
        error: l?.status === 'error' ? l.error : undefined,
        updatedAt: m.updatedAt,
        entries: data ? data.catalog.entries.map((e) => this.entryView(m.name, e, installed)) : [],
        warnings: data?.catalog.warnings ?? []
      }
    })
  }

  private entryView(marketplace: string, e: CatalogEntry, installed: PluginView[]): MarketplaceEntryView {
    const match = installed.find((p) => p.origin?.marketplace === marketplace && p.origin.entry === e.name)
    const pinned = e.source.kind === 'git' ? e.source.sha : undefined
    // Only claim an update when both sides are known: an unknown installed version isn't "older".
    const installedVersion = match?.origin?.version ?? match?.version
    const newerVersion = !!e.version && !!installedVersion && e.version !== installedVersion
    const newerCommit = !!pinned && !!match?.origin?.sha && pinned !== match.origin.sha
    const updateAvailable = !!match && (newerVersion || newerCommit)
    return {
      name: e.name,
      description: e.description,
      version: e.version,
      category: e.category,
      tags: e.tags,
      author: e.author,
      homepage: e.homepage,
      sourceLabel: describeEntrySource(e.source),
      supported: e.source.kind !== 'unsupported',
      installed: match ? { pluginId: match.id, updateAvailable } : undefined
    }
  }

  async refresh(name: string): Promise<void> {
    const m = this.state.items.find((x) => x.name === name)
    if (!m) throw new Error(`找不到 marketplace「${name}」`)
    this.loaded.set(name, { status: 'loading' })
    this.onChange()
    try {
      const data = await fetchMarketplace(m.source, cacheDir(), this.policy)
      this.loaded.set(name, { status: 'ready', data })
      m.updatedAt = new Date().toISOString()
      this.save()
    } catch (e) {
      this.loaded.set(name, { status: 'error', error: (e as Error).message })
    }
    this.onChange()
  }

  /** Loads every catalog not loaded yet (the first time the user opens the list). */
  async loadMissing(): Promise<void> {
    await Promise.all(this.state.items.filter((m) => !this.loaded.has(m.name)).map((m) => this.refresh(m.name)))
  }

  async add(input: string): Promise<string> {
    const source = parseMarketplaceInput(input)
    // Fetch first: the catalog's own name identifies the marketplace.
    const data = await fetchMarketplace(source, cacheDir(), this.policy)
    const name = data.catalog.name
    if (this.state.items.some((m) => m.name === name)) throw new Error(`已經加入過名為「${name}」的 marketplace`)
    this.state.items.push({ name, source, updatedAt: new Date().toISOString() })
    this.loaded.set(name, { status: 'ready', data })
    this.save()
    return name
  }

  remove(name: string): void {
    this.state.items = this.state.items.filter((m) => m.name !== name)
    this.loaded.delete(name)
    this.save()
  }

  /** The catalog entry and a fetcher that downloads it into a staging folder. */
  async resolve(marketplace: string, entryName: string): Promise<{ entry: CatalogEntry; fetch: (dest: string) => Promise<string> }> {
    if (this.loaded.get(marketplace)?.status !== 'ready') await this.refresh(marketplace)
    const l = this.loaded.get(marketplace)
    if (l?.status !== 'ready') throw new Error(l?.status === 'error' ? l.error : `marketplace「${marketplace}」無法載入`)
    const entry = l.data.catalog.entries.find((e) => e.name === entryName)
    if (!entry) throw new Error(`marketplace「${marketplace}」裡沒有「${entryName}」`)
    return { entry, fetch: (dest) => fetchEntry(entry, l.data, dest, this.policy) }
  }

  private save(): void {
    writeJson(statePath(), this.state)
  }
}
