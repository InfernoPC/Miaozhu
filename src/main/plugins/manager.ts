import spawn from 'cross-spawn'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { PluginPreview, PluginView } from '@shared/types'
import type { ToolDef } from '../tools/types'
import { readJson, writeJson } from '../util/json-file'
import { declaredTool } from './declared-tools'
import { looksLikePlugin, readPlugin, type LoadedPlugin } from './manifest'
import { describeTarget, McpConnection } from './mcp'
import { loadSkillTool, type SkillEntry } from './skills'

/** Where plugin secrets live; the store encrypts them like API keys. */
export interface SecretVault {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

interface StateFile {
  enabled: Record<string, boolean>
}

const pluginsDir = () => join(app.getPath('userData'), 'plugins')
const stagingDir = () => join(app.getPath('userData'), 'plugins-staging')
const statePath = () => join(app.getPath('userData'), 'plugins.json')
const secretKey = (id: string, name: string) => `plugin:${id}:${name}`

/** A folder-safe id from the plugin's name. */
export function pluginId(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return id || `plugin-${Date.now()}`
}

function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (b: Buffer) => (err = (err + b.toString()).slice(-800)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`無法執行 ${bin}：${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(err.trim() || `${bin} 結束代碼 ${code}`))
    })
  })
}

/** The plugin root inside an unpacked archive or repo: the folder itself or one level down. */
function findPluginRoot(dir: string): string | null {
  if (looksLikePlugin(dir)) return dir
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.') && looksLikePlugin(join(dir, e.name))) return join(dir, e.name)
  }
  return null
}

export class PluginManager {
  private plugins: LoadedPlugin[] = []
  private connections = new Map<string, McpConnection[]>()
  private staged = new Map<string, { dir: string; root: string; plugin: LoadedPlugin }>()
  private state: StateFile = readJson<StateFile>(statePath(), { enabled: {} })

  constructor(
    private vault: SecretVault,
    private onChange: () => void = () => {}
  ) {}

  // ── Loading and running ─────────────────────────────────────────────────

  /** Reads installed plugins and starts MCP servers for the enabled ones. */
  async start(): Promise<void> {
    mkdirSync(pluginsDir(), { recursive: true })
    rmSync(stagingDir(), { recursive: true, force: true })
    this.plugins = readdirSync(pluginsDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => readPlugin(join(pluginsDir(), e.name), e.name))
    await Promise.all(this.plugins.filter((p) => this.isEnabled(p.id)).map((p) => this.startPlugin(p)))
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.stopPlugin(id)))
  }

  private isEnabled(id: string): boolean {
    return this.state.enabled[id] !== false
  }

  private async startPlugin(p: LoadedPlugin): Promise<void> {
    await this.stopPlugin(p.id)
    const conns = p.mcpServers.map((cfg) => new McpConnection(p.name, cfg, this.onChange))
    this.connections.set(p.id, conns)
    await Promise.all(conns.map((c) => c.start()))
  }

  private async stopPlugin(id: string): Promise<void> {
    const conns = this.connections.get(id) ?? []
    this.connections.delete(id)
    await Promise.all(conns.map((c) => c.stop()))
  }

  // ── What the agent sees ─────────────────────────────────────────────────

  skills(): SkillEntry[] {
    return this.plugins.filter((p) => this.isEnabled(p.id)).flatMap((p) => p.skills.map((s) => ({ ...s, pluginName: p.name })))
  }

  /**
   * Declared tools, MCP tools and load_skill from enabled plugins. A name already taken
   * (by a built-in or an earlier plugin) is skipped rather than silently shadowing it.
   */
  tools(taken: Set<string>): ToolDef[] {
    const out: ToolDef[] = []
    const add = (t: ToolDef) => {
      if (taken.has(t.spec.name)) return
      taken.add(t.spec.name)
      out.push(t)
    }
    if (this.skills().length) add(loadSkillTool(() => this.skills()))
    for (const p of this.plugins.filter((x) => this.isEnabled(x.id))) {
      const secretValues = () => p.secretNames.map((n) => this.vault.get(secretKey(p.id, n))).filter((v): v is string => !!v)
      for (const spec of p.tools) add(declaredTool(spec, p.name, (n) => this.vault.get(secretKey(p.id, n)), secretValues))
      for (const c of this.connections.get(p.id) ?? []) c.tools.forEach(add)
    }
    return out
  }

  // ── Views ───────────────────────────────────────────────────────────────

  private toView(p: LoadedPlugin, enabled: boolean, running = true): PluginView {
    const conns = running ? (this.connections.get(p.id) ?? []) : []
    return {
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      enabled,
      skills: p.skills.map((s) => ({ name: s.name, description: s.description })),
      mcpServers: p.mcpServers.map(
        (cfg) =>
          conns.find((c) => c.config.name === cfg.name)?.view() ?? { name: cfg.name, target: describeTarget(cfg), status: 'stopped', toolCount: 0 }
      ),
      tools: p.tools.map((t) => ({
        name: t.name,
        kind: t.kind,
        risk: t.risk,
        description: t.description,
        target: t.kind === 'http' ? `${t.request!.method} ${t.request!.url}` : t.command!.join(' ')
      })),
      secrets: p.secretNames.map((name) => ({ name, isSet: !!this.vault.get(secretKey(p.id, name)) })),
      warnings: p.warnings
    }
  }

  list(): PluginView[] {
    return this.plugins.map((p) => this.toView(p, this.isEnabled(p.id)))
  }

  // ── Install / remove ────────────────────────────────────────────────────

  /**
   * Copies, unpacks or clones a plugin into a staging folder and reads it, so the user can
   * review exactly what it adds (skills, MCP commands, tools and their risk) before anything
   * is installed or run.
   */
  async inspect(source: { kind: 'folder' | 'zip'; path: string } | { kind: 'git'; url: string }): Promise<PluginPreview> {
    const stagingId = randomUUID()
    const dir = join(stagingDir(), stagingId)
    mkdirSync(dir, { recursive: true })
    try {
      if (source.kind === 'git') {
        if (!/^(https:\/\/|git@)[^\s]+$/.test(source.url)) throw new Error('請輸入 https:// 或 git@ 開頭的 Git 網址')
        await run('git', ['clone', '--depth', '1', '--', source.url, join(dir, 'repo')], dir, 120_000)
      } else if (source.kind === 'folder') {
        cpSync(source.path, join(dir, basename(source.path)), { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) })
      } else {
        // bsdtar reads zip files on macOS and on Windows 10+; no extra dependency.
        await run('tar', ['-xf', source.path, '-C', dir], dir, 60_000)
      }
      const root = findPluginRoot(dir)
      if (!root) throw new Error('裡面找不到外掛（需要 .claude-plugin/plugin.json、skills/、.mcp.json 或 tools/）')
      const plugin = readPlugin(root, pluginId(readPlugin(root).name))
      this.staged.set(stagingId, { dir, root, plugin })
      const existing = this.plugins.find((p) => p.id === plugin.id)
      return { stagingId, plugin: this.toView(plugin, true, false), replaces: existing ? existing.name : undefined }
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      throw e
    }
  }

  cancelInstall(stagingId: string): void {
    const s = this.staged.get(stagingId)
    this.staged.delete(stagingId)
    if (s) rmSync(s.dir, { recursive: true, force: true })
  }

  async install(stagingId: string): Promise<PluginView[]> {
    const s = this.staged.get(stagingId)
    if (!s) throw new Error('找不到待安裝的外掛，請重新選擇')
    this.staged.delete(stagingId)
    const target = join(pluginsDir(), s.plugin.id)
    await this.stopPlugin(s.plugin.id)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(pluginsDir(), { recursive: true })
    renameSync(s.root, target)
    rmSync(s.dir, { recursive: true, force: true })

    const installed = readPlugin(target, s.plugin.id)
    this.plugins = [...this.plugins.filter((p) => p.id !== installed.id), installed]
    this.state.enabled[installed.id] = true
    this.saveState()
    await this.startPlugin(installed)
    return this.list()
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginView[]> {
    const p = this.plugins.find((x) => x.id === id)
    if (!p) return this.list()
    this.state.enabled[id] = enabled
    this.saveState()
    if (enabled) await this.startPlugin(p)
    else await this.stopPlugin(id)
    return this.list()
  }

  async remove(id: string): Promise<PluginView[]> {
    const p = this.plugins.find((x) => x.id === id)
    await this.stopPlugin(id)
    if (p) {
      rmSync(p.dir, { recursive: true, force: true })
      for (const name of p.secretNames) this.vault.set(secretKey(id, name), '')
    }
    this.plugins = this.plugins.filter((x) => x.id !== id)
    delete this.state.enabled[id]
    this.saveState()
    return this.list()
  }

  setSecret(id: string, name: string, value: string): PluginView[] {
    this.vault.set(secretKey(id, name), value)
    return this.list()
  }

  private saveState(): void {
    writeJson(statePath(), this.state)
  }

  /** Exposed for tests: whether a plugin folder exists on disk. */
  static installedDir(id: string): string | null {
    const dir = join(pluginsDir(), id)
    return existsSync(dir) ? dir : null
  }
}
