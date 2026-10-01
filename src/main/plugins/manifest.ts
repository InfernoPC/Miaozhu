import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ToolRisk } from '@shared/types'

/** Names become model-facing tool names and must match OpenAI's function-name rules. */
export const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

export interface Skill {
  name: string
  description: string
  /** Folder holding SKILL.md and any files it references. */
  dir: string
}

export type McpServerConfig =
  | { name: string; transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { name: string; transport: 'http'; url: string; headers: Record<string, string> }

export interface DeclaredToolSpec {
  name: string
  kind: 'http' | 'cli'
  description: string
  risk: ToolRisk
  inputSchema: Record<string, unknown>
  /** http */
  request?: { method: string; url: string; headers: Record<string, string>; body?: unknown }
  /** cli: argv, never a shell string */
  command?: string[]
  timeoutSeconds?: number
}

export interface LoadedPlugin {
  id: string
  dir: string
  name: string
  version?: string
  description?: string
  skills: Skill[]
  mcpServers: McpServerConfig[]
  tools: DeclaredToolSpec[]
  /** `${secret:name}` placeholders used by declared tools. */
  secretNames: string[]
  warnings: string[]
}

const RISKS: ToolRisk[] = ['read', 'network', 'screen', 'write', 'execute']

/** `---\nkey: value\n---\nbody` → frontmatter object + body. */
export function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: text }
  const meta = parseYaml(m[1])
  return { meta: meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}, body: m[2] }
}

/** Claude Code plugins refer to their own folder as ${CLAUDE_PLUGIN_ROOT}. */
function withRoot(value: string, dir: string): string {
  return value.replace(/\$\{(CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}/g, dir)
}

function stringRecord(v: unknown, dir: string): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string').map(([k, x]) => [k, withRoot(x as string, dir)]))
}

function readJsonFile(path: string, warnings: string[]): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    warnings.push(`${basename(path)} 不是有效的 JSON：${(e as Error).message}`)
    return null
  }
}

function readSkills(dir: string, warnings: string[]): Skill[] {
  const root = join(dir, 'skills')
  if (!existsSync(root)) return []
  const skills: Skill[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(root, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    try {
      const { meta } = splitFrontmatter(readFileSync(file, 'utf8'))
      const name = typeof meta.name === 'string' ? meta.name.trim() : entry.name
      const description = typeof meta.description === 'string' ? meta.description.trim() : ''
      if (!description) warnings.push(`技能「${name}」缺少 description，喵助不知道何時該使用它`)
      skills.push({ name, description, dir: join(root, entry.name) })
    } catch (e) {
      warnings.push(`skills/${entry.name}/SKILL.md 格式錯誤：${(e as Error).message}`)
    }
  }
  return skills
}

function readMcpServers(dir: string, manifest: any, warnings: string[]): McpServerConfig[] {
  // Either a separate .mcp.json or inline in plugin.json, both keyed by server name.
  const file = join(dir, '.mcp.json')
  const fromFile = existsSync(file) ? readJsonFile(file, warnings) : null
  const servers = { ...(manifest?.mcpServers ?? {}), ...(fromFile?.mcpServers ?? fromFile ?? {}) } as Record<string, any>
  const out: McpServerConfig[] = []
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue
    if (typeof cfg.url === 'string' && (cfg.type === 'http' || cfg.type === 'sse' || !cfg.command)) {
      out.push({ name, transport: 'http', url: withRoot(cfg.url, dir), headers: stringRecord(cfg.headers, dir) })
    } else if (typeof cfg.command === 'string') {
      const args = Array.isArray(cfg.args) ? cfg.args.filter((a: unknown) => typeof a === 'string').map((a: string) => withRoot(a, dir)) : []
      out.push({ name, transport: 'stdio', command: withRoot(cfg.command, dir), args, env: stringRecord(cfg.env, dir) })
    } else {
      warnings.push(`MCP 伺服器「${name}」缺少 command 或 url，已略過`)
    }
  }
  return out
}

function readDeclaredTools(dir: string, warnings: string[]): DeclaredToolSpec[] {
  const root = join(dir, 'tools')
  if (!existsSync(root)) return []
  const tools: DeclaredToolSpec[] = []
  for (const file of readdirSync(root).filter((f) => /\.ya?ml$/i.test(f)).sort()) {
    const where = `tools/${file}`
    try {
      const t = parseYaml(readFileSync(join(root, file), 'utf8')) as any
      const kind = t?.type
      if (kind !== 'http' && kind !== 'cli') throw new Error('type 必須是 http 或 cli')
      if (typeof t.name !== 'string' || !TOOL_NAME_RE.test(t.name)) throw new Error('name 只能用英文、數字、_ 與 -，最多 64 字')
      if (typeof t.description !== 'string' || !t.description.trim()) throw new Error('缺少 description')
      const risk: ToolRisk = RISKS.includes(t.risk) ? t.risk : kind === 'http' ? 'network' : 'execute'
      const inputSchema = t.input_schema && typeof t.input_schema === 'object' ? t.input_schema : { type: 'object', properties: {} }
      const spec: DeclaredToolSpec = { name: t.name, kind, description: t.description.trim(), risk, inputSchema, timeoutSeconds: Number(t.timeout_seconds) || undefined }
      if (kind === 'http') {
        const r = t.request
        if (!r || typeof r.url !== 'string' || !/^https?:\/\//.test(r.url)) throw new Error('request.url 必須是 http(s) 網址')
        spec.request = { method: String(r.method ?? 'GET').toUpperCase(), url: r.url, headers: stringRecord(r.headers, dir), body: r.body }
      } else {
        if (!Array.isArray(t.command) || !t.command.length || !t.command.every((a: unknown) => typeof a === 'string')) {
          throw new Error('command 必須是字串陣列，例如 ["git", "log", "-n", "{count}"]')
        }
        spec.command = t.command.map((a: string) => withRoot(a, dir))
      }
      tools.push(spec)
    } catch (e) {
      warnings.push(`${where}：${(e as Error).message}`)
    }
  }
  return tools
}

/** Every `${secret:name}` in a declared tool's URL, headers, body or command. */
function secretNamesOf(tools: DeclaredToolSpec[]): string[] {
  const names = new Set<string>()
  for (const t of tools) {
    const text = JSON.stringify([t.request, t.command])
    for (const m of text.matchAll(/\$\{secret:([a-zA-Z0-9_-]+)\}/g)) names.add(m[1])
  }
  return [...names]
}

/** Reads a plugin folder. Problems become warnings so one bad file doesn't sink the plugin. */
export function readPlugin(dir: string, id = basename(dir)): LoadedPlugin {
  const warnings: string[] = []
  const manifestPath = join(dir, '.claude-plugin', 'plugin.json')
  const manifest = existsSync(manifestPath) ? readJsonFile(manifestPath, warnings) : null
  if (!manifest) warnings.push('缺少 .claude-plugin/plugin.json，以資料夾名稱作為外掛名稱')

  const skills = readSkills(dir, warnings)
  const mcpServers = readMcpServers(dir, manifest, warnings)
  const tools = readDeclaredTools(dir, warnings)
  // Parts of the Claude Code plugin format that only mean something inside Claude Code.
  const claudeOnly = [
    ['commands', '斜線指令'],
    ['agents', '子代理'],
    ['hooks', 'hooks'],
    ['output-styles', '輸出風格'],
    ['lsp', 'LSP 伺服器']
  ].filter(([key]) => existsSync(join(dir, key)) || (manifest && manifest[key] !== undefined))
  if (claudeOnly.length) warnings.push(`包含${claudeOnly.map(([, label]) => label).join('、')}，這些只在 Claude Code 裡有作用，喵助不會使用`)
  if (!skills.length && !mcpServers.length && !tools.length) warnings.push('這個外掛沒有喵助能用的技能、MCP 伺服器或工具')

  return {
    id,
    dir,
    name: typeof manifest?.name === 'string' ? manifest.name : id,
    version: typeof manifest?.version === 'string' ? manifest.version : undefined,
    description: typeof manifest?.description === 'string' ? manifest.description : undefined,
    skills,
    mcpServers,
    tools,
    secretNames: secretNamesOf(tools),
    warnings
  }
}

/** True for folders that look like a plugin root (used to find it inside an unpacked zip / repo). */
export function looksLikePlugin(dir: string): boolean {
  return ['.claude-plugin', 'skills', '.mcp.json', 'tools'].some((p) => existsSync(join(dir, p))) && statSync(dir).isDirectory()
}
