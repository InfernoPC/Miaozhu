import type { McpFormInput } from '@shared/types'

/**
 * Turns an MCP server config the user pasted (from Claude Desktop, Claude Code, VS Code or a
 * server's README) into the `.mcp.json` of a small plugin. Values that look like credentials
 * are moved out of the file and into the keychain, leaving `${secret:NAME}` behind.
 */

export interface McpImport {
  /** Name of the plugin that will hold the servers. */
  name: string
  servers: Record<string, McpServerJson>
  /** Secret name → value, to store in the keychain on install. */
  secrets: Record<string, string>
  /** Secrets referenced but not given (from `${VAR}` placeholders); the user fills them in later. */
  missing: string[]
}

export type McpServerJson =
  | { command: string; args: string[]; env: Record<string, string> }
  | { type: 'http'; url: string; headers: Record<string, string> }

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
/** Env vars and headers whose value is a credential. */
const SECRET_KEY_RE = /(token|secret|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth|pat$|^key$)/i
const PLACEHOLDER_RE = /\$\{(?!secret:|CLAUDE_PLUGIN_ROOT\}|PLUGIN_ROOT\})([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g

function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:jsonc?|json5)?\s*\n?|\n?```$/g, '')
  try {
    return JSON.parse(t)
  } catch (first) {
    // README snippets are often just `"name": { ... }` without the outer braces.
    try {
      return JSON.parse(`{${t.replace(/,\s*$/, '')}}`)
    } catch {
      throw new Error(`不是有效的 JSON：${(first as Error).message}`)
    }
  }
}

const isServer = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && (typeof (v as any).command === 'string' || typeof (v as any).url === 'string')

/** Finds the name → server map in the shapes different apps use. */
function serverMap(obj: unknown, fallbackName: string): Record<string, Record<string, unknown>> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('需要一個 JSON 物件')
  const o = obj as Record<string, any>
  if (isServer(o)) return { [fallbackName]: o }
  const map = o.mcpServers ?? o.servers ?? o.mcp?.servers ?? o
  if (!map || typeof map !== 'object') throw new Error('找不到 mcpServers')
  const entries = Object.entries(map as Record<string, unknown>).filter(([, v]) => isServer(v))
  if (!entries.length) throw new Error('找不到任何 MCP 伺服器設定（每個伺服器需要 command 或 url）')
  return Object.fromEntries(entries) as Record<string, Record<string, unknown>>
}

const strings = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string' || typeof x === 'number').map(([k, x]) => [k, String(x)]))
    : {}

const secretNameOf = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, 64) || 'SECRET'

export function parseMcpImport(text: string, name?: string): McpImport {
  if (!text.trim()) throw new Error('請貼上 MCP 設定')
  const wanted = name?.trim()
  if (wanted && !NAME_RE.test(wanted)) throw new Error('名稱只能用英文、數字、_ 與 -')
  const raw = serverMap(parseJsonLoose(text), wanted || 'mcp')

  const secrets: Record<string, string> = {}
  const missing = new Set<string>()
  /** Stores a value under a free secret name and returns the placeholder for it. */
  const stash = (server: string, key: string, value: string): string => {
    let n = secretNameOf(key)
    if (secrets[n] !== undefined && secrets[n] !== value) n = secretNameOf(`${server}_${key}`)
    secrets[n] = value
    return `\${secret:${n}}`
  }
  /** `${GITHUB_TOKEN}` means "from the environment" elsewhere; here it's a secret to fill in. */
  const placeholders = (v: string) =>
    v.replace(PLACEHOLDER_RE, (_m, n: string) => {
      missing.add(n)
      return `\${secret:${n}}`
    })

  const servers: Record<string, McpServerJson> = {}
  for (const [serverName, cfg] of Object.entries(raw)) {
    if (!NAME_RE.test(serverName)) throw new Error(`伺服器名稱「${serverName}」只能用英文、數字、_ 與 -`)
    const type = typeof cfg.type === 'string' ? cfg.type.toLowerCase() : ''
    if (typeof cfg.url === 'string' && (type !== 'stdio' || typeof cfg.command !== 'string')) {
      const url = placeholders(cfg.url.trim())
      if (!/^https?:\/\//i.test(url)) throw new Error(`「${serverName}」的 url 必須是 http(s) 網址`)
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(strings(cfg.headers))) {
        const value = placeholders(v)
        if (value.includes('${') || !(SECRET_KEY_RE.test(k) || /^authorization$/i.test(k)) || !value.trim()) {
          headers[k] = value
          continue
        }
        // Keep the scheme readable: "Bearer ${secret:AUTHORIZATION}".
        const m = value.match(/^(Bearer|Token|Basic)\s+(.+)$/i)
        headers[k] = m ? `${m[1]} ${stash(serverName, k, m[2])}` : stash(serverName, k, value)
      }
      servers[serverName] = { type: 'http', url, headers }
    } else {
      const command = String(cfg.command).trim()
      if (!command) throw new Error(`「${serverName}」缺少 command`)
      const args = Array.isArray(cfg.args) ? cfg.args.filter((a) => typeof a === 'string' || typeof a === 'number').map((a) => placeholders(String(a))) : []
      const env: Record<string, string> = {}
      for (const [k, v] of Object.entries(strings(cfg.env))) {
        const value = placeholders(v)
        env[k] = SECRET_KEY_RE.test(k) && value.trim() && !value.includes('${') ? stash(serverName, k, value) : value
      }
      servers[serverName] = { command, args, env }
    }
  }
  for (const n of Object.keys(secrets)) missing.delete(n)
  const names = Object.keys(servers)
  return { name: wanted || (names.length === 1 ? names[0] : 'mcp-servers'), servers, secrets, missing: [...missing] }
}

function lines(text = ''): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function pairs(text: string | undefined, sep: RegExp, what: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of lines(text)) {
    const m = l.match(sep)
    if (!m) throw new Error(`${what}格式不對：「${l}」`)
    out[m[1].trim()] = m[2].trim()
  }
  return out
}

/** The form's fields → the same JSON the paste box takes. */
export function formToJson(f: McpFormInput): string {
  const name = f.name.trim()
  if (!NAME_RE.test(name)) throw new Error('名稱只能用英文、數字、_ 與 -')
  if (f.transport === 'http') {
    return JSON.stringify({ mcpServers: { [name]: { type: 'http', url: (f.url ?? '').trim(), headers: pairs(f.headers, /^([^:]+):(.*)$/, '標頭') } } })
  }
  // A full command line pasted into "command" is split on spaces; arguments with spaces go one per line.
  const [command = '', ...inline] = (f.command ?? '').trim().split(/\s+/)
  return JSON.stringify({ mcpServers: { [name]: { command, args: [...inline, ...lines(f.args)], env: pairs(f.env, /^([^=]+)=(.*)$/, '環境變數') } } })
}
