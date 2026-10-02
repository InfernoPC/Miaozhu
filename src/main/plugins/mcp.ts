import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { PluginMcpView } from '@shared/types'
import { ToolError, type ToolDef } from '../tools/types'
import { SECRET_RE, TOOL_NAME_RE, type McpServerConfig } from './manifest'

const CONNECT_TIMEOUT_MS = 60_000 // `npx` may download the server on first run
const CALL_TIMEOUT_MS = 120_000
const MAX_TEXT = 20_000

/** `mcp__server__tool`, squeezed into the function-name rules models accept. */
export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  const name = `mcp__${clean(server)}__${clean(tool)}`
  return name.length <= 64 ? name : name.slice(0, 64)
}

export function describeTarget(cfg: McpServerConfig): string {
  return cfg.transport === 'http' ? cfg.url : [cfg.command, ...cfg.args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
}

/**
 * Fills `${secret:NAME}` from the keychain just before starting. The stored config (and what
 * the UI shows) keeps the placeholders.
 */
export function withSecrets(cfg: McpServerConfig, secret: (name: string) => string | undefined): { config: McpServerConfig; missing: string[] } {
  const missing = new Set<string>()
  const fill = (v: string) =>
    v.replace(SECRET_RE, (_m, n: string) => {
      const value = secret(n)
      if (!value) missing.add(n)
      return value ?? ''
    })
  const rec = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fill(v)]))
  const config: McpServerConfig =
    cfg.transport === 'http'
      ? { ...cfg, url: fill(cfg.url), headers: rec(cfg.headers) }
      : { ...cfg, command: fill(cfg.command), args: cfg.args.map(fill), env: rec(cfg.env) }
  return { config, missing: [...missing] }
}

type McpContent = { type: string; text?: string; data?: string; mimeType?: string; resource?: { text?: string; uri?: string } }

/** One running MCP server and the tools it offers. */
export class McpConnection {
  status: PluginMcpView['status'] = 'stopped'
  error?: string
  tools: ToolDef[] = []
  private client: Client | null = null
  private stderrTail = ''

  constructor(
    readonly pluginName: string,
    readonly config: McpServerConfig,
    private onChange: () => void,
    private secret: (name: string) => string | undefined = () => undefined
  ) {}

  view(): PluginMcpView {
    return { name: this.config.name, target: describeTarget(this.config), status: this.status, error: this.error, toolCount: this.tools.length }
  }

  async start(): Promise<void> {
    this.status = 'starting'
    this.error = undefined
    this.onChange()
    const { config, missing } = withSecrets(this.config, this.secret)
    if (missing.length) {
      this.status = 'error'
      this.error = `還沒填密鑰：${missing.join('、')}。請在下方「密鑰」填入，填好後會自動啟動。`
      this.onChange()
      return
    }
    const client = new Client({ name: 'miaozhu', version: '0.1.0' })
    try {
      const transport =
        config.transport === 'http'
          ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
          : new StdioClientTransport({
              command: config.command,
              args: config.args,
              env: { ...getDefaultEnvironment(), ...config.env },
              stderr: 'pipe'
            })
      if (transport instanceof StdioClientTransport) {
        // Keep the last lines of the server's own log to explain start-up failures.
        transport.stderr?.on('data', (b: Buffer) => {
          this.stderrTail = (this.stderrTail + b.toString('utf8')).slice(-1500)
        })
      }
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
      this.client = client
      this.tools = await this.listTools()
      this.status = 'running'
    } catch (e) {
      this.status = 'error'
      const tail = this.stderrTail.trim().split('\n').slice(-5).join('\n')
      let error = `${(e as Error).message}${tail ? `\n${tail}` : ''}`
      // A server may echo its own URL or token back in an error.
      for (const m of JSON.stringify(this.config).matchAll(SECRET_RE)) {
        const v = this.secret(m[1])
        if (v && v.length >= 4) error = error.split(v).join('••••')
      }
      this.error = error
      this.tools = []
      await client.close().catch(() => {})
    }
    this.onChange()
  }

  async stop(): Promise<void> {
    const c = this.client
    this.client = null
    this.tools = []
    this.status = 'stopped'
    await c?.close().catch(() => {})
  }

  private async listTools(): Promise<ToolDef[]> {
    const defs: ToolDef[] = []
    let cursor: string | undefined
    do {
      const page = await this.client!.listTools(cursor ? { cursor } : undefined)
      for (const t of page.tools) {
        const name = mcpToolName(this.config.name, t.name)
        if (!TOOL_NAME_RE.test(name)) continue
        defs.push(this.toToolDef(name, t))
      }
      cursor = page.nextCursor
    } while (cursor)
    return defs
  }

  private toToolDef(name: string, t: { name: string; title?: string; description?: string; inputSchema: Record<string, unknown> }): ToolDef {
    const server = this.config.name
    return {
      spec: {
        name,
        description: `${t.description ?? t.title ?? t.name}（外掛「${this.pluginName}」的 MCP 伺服器 ${server}）`,
        parameters: t.inputSchema?.type === 'object' ? t.inputSchema : { type: 'object', properties: {} }
      },
      // Whatever the server claims about itself, a call runs someone else's code: ask first.
      risk: 'execute',
      title: () => `${server}：${t.title ?? t.name}`,
      detail: (i) => {
        const args = JSON.stringify(i, null, 2)
        return `${args.length > 1200 ? args.slice(0, 1200) + '\n…' : args}\n\n（由外掛「${this.pluginName}」的 MCP 伺服器 ${server} 執行）`
      },
      run: async (input, ctx) => {
        if (!this.client) throw new ToolError(`MCP 伺服器 ${server} 沒有在執行`)
        const result = await this.client.callTool({ name: t.name, arguments: input }, undefined, { timeout: CALL_TIMEOUT_MS, signal: ctx.signal })
        const content = (Array.isArray(result.content) ? result.content : []) as McpContent[]
        const texts: string[] = []
        const images: string[] = []
        for (const c of content) {
          if (c.type === 'text' && c.text) texts.push(c.text)
          else if (c.type === 'image' && c.data) images.push(`data:${c.mimeType ?? 'image/png'};base64,${c.data}`)
          else if (c.type === 'resource' && c.resource) texts.push(c.resource.text ?? c.resource.uri ?? '')
        }
        const text = texts.join('\n\n') || (images.length ? '（工具回傳了圖片，附在下一則訊息）' : '（沒有輸出）')
        if (result.isError) throw new ToolError(text.slice(0, 2000))
        return {
          text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n…（結果過長，已截斷）' : text,
          summary: images.length ? `${images.length} 張圖片` : '完成',
          images: images.length ? images : undefined
        }
      }
    }
  }
}
