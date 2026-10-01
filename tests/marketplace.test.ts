import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPlugin } from '../src/main/plugins/manifest'
import { PluginManager } from '../src/main/plugins/manager'
import { parseCatalog, parseMarketplaceInput } from '../src/main/plugins/marketplace'
import { DEFAULT_MARKETPLACE, MarketplaceManager } from '../src/main/plugins/marketplaces'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox

function write(dir: string, files: Record<string, string | object>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
}

/** A real git repository on disk, standing in for a hosted one. Returns its HEAD commit. */
function gitRepo(dir: string, files: Record<string, string | object>, message = 'init'): string {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir }).toString().trim()
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true })
    git('init', '-q', '-b', 'main')
    // Let clients fetch by commit and use partial clones, as GitHub does.
    git('config', 'uploadpack.allowReachableSHA1InWant', 'true')
    git('config', 'uploadpack.allowFilter', 'true')
  }
  write(dir, files)
  git('add', '-A')
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

const url = (dir: string) => pathToFileURL(dir).href
const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n${name} 的步驟`

let soloV1: string
let marketDir: string

beforeAll(() => {
  sb = makeSandbox()
  // A plugin in its own repo; v1 is pinned by the catalog, v2 lands afterwards.
  const solo = sb.path('repos', 'solo')
  soloV1 = gitRepo(solo, { '.claude-plugin/plugin.json': { name: 'solo', version: '1.0.0' }, 'skills/solo/SKILL.md': skill('solo', '第一版') })
  gitRepo(solo, { 'skills/solo/SKILL.md': skill('solo', '第二版（不該被裝到）') }, 'v2')

  // A monorepo with the plugin in a subfolder, next to unrelated big content.
  const mono = sb.path('repos', 'mono')
  gitRepo(mono, {
    'packages/helper/.claude-plugin/plugin.json': { name: 'helper' },
    'packages/helper/skills/help/SKILL.md': skill('help', '幫忙'),
    'packages/other/huge.txt': 'x'.repeat(200_000)
  })

  marketDir = sb.path('repos', 'market')
  gitRepo(marketDir, {
    '.claude-plugin/marketplace.json': {
      name: 'team-market',
      description: '團隊外掛',
      owner: { name: 'IT' },
      metadata: { pluginRoot: './plugins' },
      plugins: [
        { name: 'notes', source: './plugins/notes', version: '1.0.0', category: 'productivity', description: '筆記' },
        { name: 'bare', source: 'bare' },
        { name: 'solo', source: { source: 'url', url: url(solo), sha: soloV1 } },
        { name: 'helper', source: { source: 'git-subdir', url: url(mono), path: 'packages/helper' } },
        { name: 'npm-thing', source: { source: 'npm', package: '@x/y' } },
        { name: 'escape', source: './../outside' },
        { name: 'notes', source: './plugins/notes' }
      ]
    },
    'plugins/notes/.claude-plugin/plugin.json': { name: 'notes' },
    'plugins/notes/skills/notes/SKILL.md': skill('notes', '寫筆記'),
    'plugins/notes/commands/hello.md': 'a Claude Code slash command',
    'plugins/bare/skills/bare/SKILL.md': skill('bare', '裸名稱')
  })
})
afterAll(() => sb.cleanup())

describe('parsing', () => {
  it('reads every way of naming a marketplace', () => {
    expect(parseMarketplaceInput('anthropics/claude-plugins-official')).toEqual({ kind: 'github', repo: 'anthropics/claude-plugins-official', ref: undefined })
    expect(parseMarketplaceInput('acme/plugins@v2')).toMatchObject({ kind: 'github', ref: 'v2' })
    expect(parseMarketplaceInput('git@git.example.com:it/market.git')).toMatchObject({ kind: 'git' })
    expect(parseMarketplaceInput('https://gitlab.com/acme/market')).toMatchObject({ kind: 'git' })
    expect(parseMarketplaceInput('https://git.example.com/acme/market.git#main')).toEqual({ kind: 'git', url: 'https://git.example.com/acme/market.git', ref: 'main' })
    expect(parseMarketplaceInput('https://example.com/marketplace.json')).toEqual({ kind: 'url', url: 'https://example.com/marketplace.json' })
    expect(parseMarketplaceInput('~/market')).toEqual({ kind: 'directory', path: sb.path('market') })
    expect(parseMarketplaceInput('~/market/.claude-plugin/marketplace.json')).toEqual({ kind: 'directory', path: sb.path('market') })
  })

  it('keeps going past bad entries and marks sources it cannot fetch', () => {
    const c = parseCatalog(JSON.parse(readFileSync(join(marketDir, '.claude-plugin/marketplace.json'), 'utf8')))
    expect(c).toMatchObject({ name: 'team-market', owner: 'IT' })
    expect(c.entries.map((e) => [e.name, e.source.kind])).toEqual([
      ['notes', 'relative'],
      ['bare', 'relative'],
      ['solo', 'git'],
      ['helper', 'git'],
      ['npm-thing', 'unsupported'],
      ['escape', 'unsupported']
    ])
    expect(c.entries[1].source).toEqual({ kind: 'relative', path: './plugins/bare' })
    expect(c.warnings).toEqual([expect.stringContaining('重複')])
  })

  it('rejects a catalog without a name or plugin list', () => {
    expect(() => parseCatalog({ plugins: [] })).toThrow('name')
    expect(() => parseCatalog({ name: 'x' })).toThrow('plugins')
  })
})

describe('marketplaces and installs', () => {
  let markets: MarketplaceManager
  let plugins: PluginManager
  const vault = { get: () => undefined, set: () => {} }

  const install = async (entry: string) => {
    const { entry: e, fetch } = await markets.resolve('team-market', entry)
    const sha = e.source.kind === 'git' ? e.source.sha : undefined
    const preview = await plugins.inspect({ kind: 'entry', fetch, origin: { marketplace: 'team-market', entry, version: e.version, sha } })
    await plugins.install(preview.stagingId)
    return preview
  }
  const view = () => markets.list(plugins.list()).find((m) => m.name === 'team-market')!

  beforeAll(async () => {
    markets = new MarketplaceManager({ allowFileUrls: true })
    plugins = new PluginManager(vault)
    await plugins.start()
  })
  afterAll(() => plugins.stopAll())

  it('offers the official marketplace on first launch without downloading it', () => {
    const [first] = markets.list([])
    expect(first).toMatchObject({ name: DEFAULT_MARKETPLACE.name, isDefault: true, status: 'not-loaded', entries: [] })
  })

  it('remembers that the user removed the default', () => {
    markets.remove(DEFAULT_MARKETPLACE.name)
    expect(new MarketplaceManager().list([])).toEqual([])
  })

  it('adds a git marketplace by its catalog name and refuses duplicates', async () => {
    expect(await markets.add(url(marketDir))).toBe('team-market')
    expect(view()).toMatchObject({ status: 'ready', description: '團隊外掛', owner: 'IT' })
    await expect(markets.add(url(marketDir))).rejects.toThrow('已經加入過')
  })

  it('does not accept local file:// git URLs unless allowed (remote catalogs must not read local repos)', async () => {
    await expect(new MarketplaceManager().add(url(marketDir))).rejects.toThrow('只接受 https:// 或 git@')
  })

  it('installs a plugin stored inside the marketplace, and flags Claude Code-only parts', async () => {
    const preview = await install('notes')
    expect(preview.plugin.warnings).toEqual([expect.stringContaining('斜線指令')])
    const notes = plugins.list().find((p) => p.id === 'notes')!
    expect(notes.origin).toEqual({ marketplace: 'team-market', entry: 'notes', version: '1.0.0' })
    expect(view().entries.find((e) => e.name === 'notes')!.installed).toEqual({ pluginId: 'notes', updateAvailable: false })
    // Copied out of the marketplace cache, not moved: the catalog keeps working.
    expect(existsSync(join(PluginManager.installedDir('notes')!, 'skills/notes/SKILL.md'))).toBe(true)
  })

  it('installs the commit the catalog pinned, even after the branch moved on', async () => {
    await install('solo')
    const text = readFileSync(join(PluginManager.installedDir('solo')!, 'skills/solo/SKILL.md'), 'utf8')
    expect(text).toContain('第一版')
  })

  it('installs one folder of a monorepo without the rest', async () => {
    await install('helper')
    const dir = PluginManager.installedDir('helper')!
    expect(readPlugin(dir).skills.map((s) => s.name)).toEqual(['help'])
    expect(existsSync(join(dir, '..', 'other'))).toBe(false)
  })

  it('refuses sources it does not support, with the reason', async () => {
    await expect(install('npm-thing')).rejects.toThrow('不支援')
    await expect(install('escape')).rejects.toThrow('..')
    expect(view().entries.find((e) => e.name === 'npm-thing')!.supported).toBe(false)
  })

  it('notices a new version after a refresh, and clears it after updating', async () => {
    const catalogFile = join(marketDir, '.claude-plugin/marketplace.json')
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'))
    catalog.plugins[0].version = '1.1.0'
    gitRepo(marketDir, { '.claude-plugin/marketplace.json': catalog, 'plugins/notes/skills/notes/SKILL.md': skill('notes', '寫筆記 v1.1') }, 'bump')

    expect(view().entries[0].installed?.updateAvailable).toBe(false)
    await markets.refresh('team-market')
    expect(view().entries[0].installed?.updateAvailable).toBe(true)

    await install('notes')
    expect(view().entries[0].installed?.updateAvailable).toBe(false)
    expect(readFileSync(join(PluginManager.installedDir('notes')!, 'skills/notes/SKILL.md'), 'utf8')).toContain('v1.1')
  })

  it('does not claim an update when the installed version is unknown', () => {
    const fake = [{ id: 'x', name: 'x', enabled: true, skills: [], mcpServers: [], tools: [], secrets: [], warnings: [], origin: { marketplace: 'team-market', entry: 'bare' } }]
    const catalog = JSON.parse(readFileSync(join(marketDir, '.claude-plugin/marketplace.json'), 'utf8'))
    expect(catalog.plugins[1].name).toBe('bare')
    expect(markets.list(fake).find((m) => m.name === 'team-market')!.entries.find((e) => e.name === 'bare')!.installed).toEqual({ pluginId: 'x', updateAvailable: false })
  })

  it('reads a marketplace from a local folder', async () => {
    const local = sb.path('local-market')
    write(local, {
      '.claude-plugin/marketplace.json': { name: 'local-market', owner: { name: 'me' }, plugins: [{ name: 'tiny', source: './tiny' }] },
      'tiny/skills/tiny/SKILL.md': skill('tiny', '小')
    })
    expect(await markets.add(local)).toBe('local-market')
    const { fetch } = await markets.resolve('local-market', 'tiny')
    const preview = await plugins.inspect({ kind: 'entry', fetch, origin: { marketplace: 'local-market', entry: 'tiny' } })
    expect(preview.plugin.skills.map((s) => s.name)).toEqual(['tiny'])
    plugins.cancelInstall(preview.stagingId)
    expect(existsSync(join(local, 'tiny'))).toBe(true)
  })
})
