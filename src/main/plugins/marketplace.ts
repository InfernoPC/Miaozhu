import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { isPrivateHost } from '../tools/web'
import { expandPath, isInside } from '../tools/paths'
import { run } from '../util/run'

const GIT_TIMEOUT_MS = 180_000
const MAX_CATALOG_BYTES = 5 * 1024 ** 2
const MAX_ARCHIVE_BYTES = 100 * 1024 ** 2
const CATALOG_PATH = '.claude-plugin/marketplace.json'

/** Where a marketplace's catalog comes from (Claude Code "marketplace source"). */
export type MarketplaceSource =
  | { kind: 'github'; repo: string; ref?: string }
  | { kind: 'git'; url: string; ref?: string }
  | { kind: 'directory'; path: string }
  | { kind: 'url'; url: string }

/** Where one plugin comes from (Claude Code "plugin source"), normalized. */
export type EntrySource =
  | { kind: 'relative'; path: string }
  | { kind: 'git'; url: string; ref?: string; sha?: string; subdir?: string }
  | { kind: 'archive'; url: string; sha256?: string }
  | { kind: 'unsupported'; type: string }

export interface CatalogEntry {
  name: string
  description?: string
  version?: string
  category?: string
  tags: string[]
  author?: string
  homepage?: string
  source: EntrySource
  popularity?: { value: number; kind: 'installs' | 'downloads' | 'score' }
}

/**
 * Claude Code catalogs carry no install counts, but entries may set a free-form `metadata`
 * object for the marketplace's own use; a marketplace that tracks installs can publish them there.
 */
function popularityOf(metadata: unknown): CatalogEntry['popularity'] {
  if (!metadata || typeof metadata !== 'object') return undefined
  const m = metadata as Record<string, unknown>
  for (const [key, kind] of [['installs', 'installs'], ['downloads', 'downloads'], ['popularity', 'score']] as const) {
    const v = typeof m[key] === 'string' ? Number(m[key]) : m[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { value: v, kind }
  }
  return undefined
}

export interface Catalog {
  name: string
  description?: string
  owner?: string
  entries: CatalogEntry[]
  /** Entries that couldn't be read; the rest of the catalog still works. */
  warnings: string[]
}

export interface FetchPolicy {
  /** file:// git URLs; only for tests. Remote catalogs must not point at local repositories. */
  allowFileUrls?: boolean
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const SHA_RE = /^[0-9a-f]{40}$/

/** `owner/repo`, `owner/repo@ref`, a git URL, a link to marketplace.json, or a local folder. */
export function parseMarketplaceInput(raw: string): MarketplaceSource {
  const input = raw.trim()
  if (!input) throw new Error('請輸入 marketplace 位置')
  const shorthand = input.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(?:[@#]([^\s]+))?$/)
  if (shorthand && !input.startsWith('.')) return { kind: 'github', repo: shorthand[1], ref: shorthand[2] }
  // file:// is a git URL too; whether it's allowed is up to the fetch policy.
  if (/^git@[^\s:]+:[^\s]+$/.test(input) || /^file:\/\//.test(input)) {
    const [url, ref] = input.split('#')
    return { kind: 'git', url, ref }
  }
  if (/^https?:\/\//.test(input)) {
    const [url, ref] = input.split('#')
    const u = new URL(url)
    const repoLike = /\.git$/.test(u.pathname) || u.pathname.includes('/_git/') || (/^(www\.)?(github|gitlab)\.com$/.test(u.hostname) && u.pathname.split('/').filter(Boolean).length === 2)
    return repoLike ? { kind: 'git', url, ref } : { kind: 'url', url }
  }
  const path = expandPath(input)
  // A path to the json file itself means its marketplace root, two levels up.
  return { kind: 'directory', path: /\.json$/i.test(path) ? dirname(dirname(path)) : path }
}

export function describeSource(src: MarketplaceSource): string {
  switch (src.kind) {
    case 'github':
      return `github.com/${src.repo}${src.ref ? `@${src.ref}` : ''}`
    case 'git':
      return `${src.url}${src.ref ? `#${src.ref}` : ''}`
    case 'directory':
      return src.path
    case 'url':
      return src.url
  }
}

function gitUrl(raw: string, policy: FetchPolicy): string {
  // owner/repo shorthand is GitHub, as in Claude Code.
  const url = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(raw) ? `https://github.com/${raw}.git` : raw
  const ok = /^https:\/\/[^\s]+$/.test(url) || /^git@[^\s:]+:[^\s]+$/.test(url) || (policy.allowFileUrls && /^file:\/\//.test(url))
  if (!ok) throw new Error(`不支援這個 Git 網址（只接受 https:// 或 git@）：${raw}`)
  return url
}

function normalizeSource(source: unknown, pluginRoot: string | undefined): EntrySource {
  if (typeof source === 'string') {
    // Bare names resolve under metadata.pluginRoot; everything else must be ./relative.
    const path = !source.startsWith('./') && source !== '.' && !source.includes('/') && pluginRoot ? `${pluginRoot.replace(/\/$/, '')}/${source}` : source
    if (path !== '.' && !path.startsWith('./')) return { kind: 'unsupported', type: `路徑需以 ./ 開頭：${source}` }
    if (path.split('/').includes('..')) return { kind: 'unsupported', type: `路徑不能包含 ..：${source}` }
    return { kind: 'relative', path }
  }
  const s = source as Record<string, unknown>
  const ref = typeof s.ref === 'string' ? s.ref : undefined
  const sha = typeof s.sha === 'string' && SHA_RE.test(s.sha) ? s.sha : undefined
  switch (s?.source) {
    case 'github':
      return typeof s.repo === 'string' ? { kind: 'git', url: s.repo, ref, sha } : { kind: 'unsupported', type: 'github 缺少 repo' }
    case 'url':
      return typeof s.url === 'string' ? { kind: 'git', url: s.url, ref, sha } : { kind: 'unsupported', type: 'url 缺少網址' }
    case 'git-subdir':
      if (typeof s.url !== 'string' || typeof s.path !== 'string') return { kind: 'unsupported', type: 'git-subdir 缺少 url 或 path' }
      if (s.path.split('/').includes('..')) return { kind: 'unsupported', type: 'git-subdir 的 path 不能包含 ..' }
      return { kind: 'git', url: s.url, ref, sha, subdir: s.path.replace(/^\.\//, '') }
    case 'archive':
      return typeof s.url === 'string' ? { kind: 'archive', url: s.url, sha256: typeof s.sha256 === 'string' ? s.sha256.toLowerCase() : undefined } : { kind: 'unsupported', type: 'archive 缺少網址' }
    default:
      // npm needs an npm client; command runs a shell command on the user's machine.
      return { kind: 'unsupported', type: String(s?.source ?? '未知') }
  }
}

export function parseCatalog(json: unknown): Catalog {
  const m = json as Record<string, any>
  if (!m || typeof m !== 'object') throw new Error('marketplace.json 不是 JSON 物件')
  if (typeof m.name !== 'string' || !NAME_RE.test(m.name)) throw new Error('marketplace.json 的 name 缺少或格式不正確')
  if (!Array.isArray(m.plugins)) throw new Error('marketplace.json 缺少 plugins 清單')
  const warnings: string[] = []
  const seen = new Set<string>()
  const pluginRoot = typeof m.metadata?.pluginRoot === 'string' ? m.metadata.pluginRoot : undefined
  const entries: CatalogEntry[] = []
  m.plugins.forEach((p: any, i: number) => {
    if (typeof p?.name !== 'string' || !NAME_RE.test(p.name)) return void warnings.push(`第 ${i + 1} 個外掛的 name 格式不正確，已略過`)
    if (seen.has(p.name)) return void warnings.push(`外掛名稱「${p.name}」重複，已略過後面的`)
    if (p.source === undefined) return void warnings.push(`外掛「${p.name}」缺少 source，已略過`)
    seen.add(p.name)
    entries.push({
      name: p.name,
      description: typeof p.description === 'string' ? p.description : undefined,
      version: typeof p.version === 'string' ? p.version : undefined,
      category: typeof p.category === 'string' ? p.category : undefined,
      tags: Array.isArray(p.tags) ? p.tags.filter((t: unknown) => typeof t === 'string') : [],
      author: typeof p.author === 'string' ? p.author : typeof p.author?.name === 'string' ? p.author.name : undefined,
      homepage: typeof p.homepage === 'string' ? p.homepage : undefined,
      source: normalizeSource(p.source, pluginRoot),
      popularity: popularityOf(p.metadata)
    })
  })
  return {
    name: m.name,
    description: typeof m.description === 'string' ? m.description : typeof m.metadata?.description === 'string' ? m.metadata.description : undefined,
    owner: typeof m.owner?.name === 'string' ? m.owner.name : undefined,
    entries,
    warnings
  }
}

/**
 * A shallow, blob-less, sparse clone: just the files needed right now. For a marketplace
 * that's the catalog; plugin folders are added on install (`git sparse-checkout add`).
 */
async function sparseClone(url: string, dest: string, opts: { ref?: string; sha?: string; paths: string[] }): Promise<void> {
  mkdirSync(dest, { recursive: true })
  const git = (...args: string[]) => run('git', args, dest, GIT_TIMEOUT_MS)
  await git('init', '-q')
  await git('remote', 'add', 'origin', url)
  await git('config', 'core.sparseCheckout', 'true')
  await git('sparse-checkout', 'set', '--no-cone', ...opts.paths)
  // Fetching by SHA pins the exact commit the catalog reviewed; otherwise the ref or default branch.
  await git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', opts.sha ?? opts.ref ?? 'HEAD')
  await git('checkout', '-q', 'FETCH_HEAD')
}

async function downloadLimited(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' })
  if (!res.ok) throw new Error(`下載失敗（HTTP ${res.status}）：${url}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new Error(`檔案太大（${Math.round(declared / 1024 ** 2)} MB）`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error('檔案太大')
  return buf
}

function assertPublicHttps(raw: string): void {
  const u = new URL(raw)
  if (u.protocol !== 'https:') throw new Error(`只接受 https 網址：${raw}`)
  if (isPrivateHost(u.hostname)) throw new Error(`不能從本機或內網位址下載：${u.hostname}`)
}

/** A fetched marketplace: its catalog and, for git/directory sources, a local copy of the repo. */
export interface FetchedMarketplace {
  catalog: Catalog
  /** The marketplace root on disk; absent for url sources (catalog only). */
  root?: string
  /** Remote repo for git/github sources, used to add plugin folders on install. */
  git?: { url: string }
}

export async function fetchMarketplace(src: MarketplaceSource, cacheDir: string, policy: FetchPolicy = {}): Promise<FetchedMarketplace> {
  if (src.kind === 'directory') {
    const file = join(src.path, CATALOG_PATH)
    if (!existsSync(file)) throw new Error(`這個資料夾裡沒有 ${CATALOG_PATH}`)
    return { catalog: parseCatalog(JSON.parse(readFileSync(file, 'utf8'))), root: src.path }
  }
  if (src.kind === 'url') {
    assertPublicHttps(src.url)
    const catalog = parseCatalog(JSON.parse((await downloadLimited(src.url, MAX_CATALOG_BYTES)).toString('utf8')))
    return { catalog }
  }
  const url = gitUrl(src.kind === 'github' ? src.repo : src.url, policy)
  const dest = join(cacheDir, createHash('sha1').update(url).digest('hex').slice(0, 12))
  rmSync(dest, { recursive: true, force: true })
  await sparseClone(url, dest, { ref: src.ref, paths: ['/.claude-plugin/'] })
  const file = join(dest, CATALOG_PATH)
  if (!existsSync(file)) throw new Error(`這個 repo 裡沒有 ${CATALOG_PATH}`)
  return { catalog: parseCatalog(JSON.parse(readFileSync(file, 'utf8'))), root: dest, git: { url } }
}

/**
 * Downloads one catalog entry into `dest` and returns the folder holding the plugin.
 * Every source is fetched into the staging area; nothing is installed or run here.
 */
export async function fetchEntry(entry: CatalogEntry, market: FetchedMarketplace, dest: string, policy: FetchPolicy = {}): Promise<string> {
  const src = entry.source
  mkdirSync(dest, { recursive: true })
  if (src.kind === 'unsupported') throw new Error(`這個外掛的來源喵助不支援（${src.type}）`)

  if (src.kind === 'relative') {
    if (!market.root) throw new Error('這個 marketplace 只提供目錄檔，無法取得放在裡面的外掛')
    const rel = src.path === '.' ? '' : src.path.slice(2)
    // Make sure the folder is checked out in a sparse marketplace clone.
    if (market.git && rel) await run('git', ['sparse-checkout', 'add', `/${rel}/`], market.root, GIT_TIMEOUT_MS)
    const root = realpathSync(market.root)
    const target = resolve(root, rel)
    if (!existsSync(target)) throw new Error(`marketplace 裡找不到外掛資料夾：${src.path}`)
    if (!isInside(realpathSync(target), root)) throw new Error('外掛路徑指向 marketplace 以外的位置，已拒絕')
    return target
  }

  if (src.kind === 'git') {
    const url = gitUrl(src.url, policy)
    const repo = join(dest, 'repo')
    await sparseClone(url, repo, { ref: src.ref, sha: src.sha, paths: [src.subdir ? `/${src.subdir}/` : '/*'] })
    const target = src.subdir ? resolve(repo, src.subdir) : repo
    if (!isInside(target, repo) || !existsSync(target)) throw new Error(`repo 裡找不到外掛資料夾：${src.subdir ?? '/'}`)
    return target
  }

  // archive
  assertPublicHttps(src.url)
  const buf = await downloadLimited(src.url, MAX_ARCHIVE_BYTES)
  if (src.sha256 && createHash('sha256').update(buf).digest('hex') !== src.sha256) throw new Error('下載的檔案與 marketplace 記錄的 SHA-256 不符，已停止安裝')
  const zip = join(dest, 'plugin.zip')
  writeFileSync(zip, buf)
  const out = join(dest, 'unpacked')
  mkdirSync(out)
  await run('tar', ['-xf', zip, '-C', out], dest, 60_000)
  return out
}

/** Short display form of an entry's source, for the catalog list. */
export function describeEntrySource(src: EntrySource): string {
  switch (src.kind) {
    case 'relative':
      return `marketplace 內 ${src.path}`
    case 'git':
      return `${src.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}${src.subdir ? `/${src.subdir}` : ''}${src.sha ? `@${src.sha.slice(0, 7)}` : src.ref ? `@${src.ref}` : ''}`
    case 'archive':
      return basename(new URL(src.url).pathname)
    case 'unsupported':
      return `不支援：${src.type}`
  }
}

