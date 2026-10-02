import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PluginManager } from '../src/main/plugins/manager'
import { formToJson, parseMcpImport } from '../src/main/plugins/mcp-import'
import type { ToolContext } from '../src/main/tools/types'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

const MCP_SERVER = resolve(__dirname, 'fixtures/test-mcp-server.mjs')

describe('reading a pasted MCP config', () => {
  it('takes the Claude Desktop / Claude Code shape', () => {
    const r = parseMcpImport(JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } } }))
    expect(r).toMatchObject({ name: 'github', servers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: {} } } })
  })

  it('takes VS Code shapes, a bare map and a README snippet without outer braces', () => {
    expect(Object.keys(parseMcpImport('{"servers":{"a":{"command":"x"}}}').servers)).toEqual(['a'])
    expect(Object.keys(parseMcpImport('{"mcp":{"servers":{"b":{"url":"https://b.test/mcp"}}}}').servers)).toEqual(['b'])
    expect(Object.keys(parseMcpImport('{"c":{"command":"x"},"d":{"command":"y"}}').servers)).toEqual(['c', 'd'])
    expect(Object.keys(parseMcpImport('"e": { "command": "uvx", "args": ["e-server"] },').servers)).toEqual(['e'])
    expect(Object.keys(parseMcpImport('```json\n{"f":{"command":"x"}}\n```').servers)).toEqual(['f'])
  })

  it('a single server object takes the given name', () => {
    expect(parseMcpImport('{"command":"npx","args":["srv"]}', 'my-server')).toMatchObject({ name: 'my-server', servers: { 'my-server': { command: 'npx' } } })
  })

  it('names several servers as one bundle unless told otherwise', () => {
    expect(parseMcpImport('{"a":{"command":"x"},"b":{"command":"y"}}').name).toBe('mcp-servers')
    expect(parseMcpImport('{"a":{"command":"x"},"b":{"command":"y"}}', 'team-tools').name).toBe('team-tools')
  })

  it('moves credentials out of env and headers, keeping the auth scheme', () => {
    const r = parseMcpImport(
      JSON.stringify({
        mcpServers: {
          gh: { command: 'npx', env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc', LOG_LEVEL: 'info' } },
          api: { type: 'http', url: 'https://api.test/mcp', headers: { Authorization: 'Bearer sk-123', 'X-Team': 'ops' } }
        }
      })
    )
    expect(r.servers.gh).toMatchObject({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${secret:GITHUB_PERSONAL_ACCESS_TOKEN}', LOG_LEVEL: 'info' } })
    expect(r.servers.api).toMatchObject({ headers: { Authorization: 'Bearer ${secret:AUTHORIZATION}', 'X-Team': 'ops' } })
    expect(r.secrets).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc', AUTHORIZATION: 'sk-123' })
    expect(JSON.stringify(r.servers)).not.toMatch(/ghp_abc|sk-123/)
  })

  it('two servers with the same key but different values get separate secrets', () => {
    const r = parseMcpImport('{"a":{"command":"x","env":{"API_KEY":"one"}},"b":{"command":"y","env":{"API_KEY":"two"}}}')
    expect(r.secrets).toEqual({ API_KEY: 'one', B_API_KEY: 'two' })
  })

  it('${VAR} placeholders become secrets to fill in later', () => {
    const r = parseMcpImport('{"a":{"command":"x","env":{"TOKEN":"${MY_TOKEN}"},"args":["--key=${OTHER}"]}}')
    expect(r.servers.a).toMatchObject({ env: { TOKEN: '${secret:MY_TOKEN}' }, args: ['--key=${secret:OTHER}'] })
    expect(r.missing.sort()).toEqual(['MY_TOKEN', 'OTHER'])
    expect(r.secrets).toEqual({})
  })

  it('explains what is wrong', () => {
    expect(() => parseMcpImport('')).toThrow('請貼上')
    expect(() => parseMcpImport('{nope')).toThrow('不是有效的 JSON')
    expect(() => parseMcpImport('{"a":{"args":[]}}')).toThrow('找不到任何 MCP 伺服器')
    expect(() => parseMcpImport('{"a":{"url":"ftp://x"}}')).toThrow('http(s)')
    expect(() => parseMcpImport('{"bad name":{"command":"x"}}')).toThrow('伺服器名稱')
  })
})

describe('the add-server form', () => {
  it('builds a local server: a whole command line, extra args per line, KEY=value env', () => {
    const json = formToJson({ name: 'fs', transport: 'stdio', command: 'npx -y @modelcontextprotocol/server-filesystem', args: '/Users/me/My Docs\n', env: 'API_KEY=abc\nMODE = fast' })
    const r = parseMcpImport(json)
    expect(r.servers.fs).toEqual({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/My Docs'], env: { API_KEY: '${secret:API_KEY}', MODE: 'fast' } })
    expect(r.secrets).toEqual({ API_KEY: 'abc' })
  })

  it('builds a remote server with headers', () => {
    const r = parseMcpImport(formToJson({ name: 'remote', transport: 'http', url: 'https://mcp.test/mcp', headers: 'Authorization: Bearer t0k\nX-Org: a:b' }))
    expect(r.servers.remote).toEqual({ type: 'http', url: 'https://mcp.test/mcp', headers: { Authorization: 'Bearer ${secret:AUTHORIZATION}', 'X-Org': 'a:b' } })
  })

  it('rejects malformed lines', () => {
    expect(() => formToJson({ name: 'x', transport: 'stdio', command: 'x', env: 'NOEQUALS' })).toThrow('環境變數格式不對')
    expect(() => formToJson({ name: 'bad name', transport: 'stdio', command: 'x' })).toThrow('名稱')
  })
})

describe('installing a pasted server', () => {
  let sb: Sandbox
  let manager: PluginManager
  const data = new Map<string, string>()
  const vault = { get: (k: string) => data.get(k), set: (k: string, v: string) => (v ? data.set(k, v) : data.delete(k)) }
  const ctx = { signal: new AbortController().signal, search: () => ({ config: { provider: 'none' } }), isBlocked: () => false, hidePet: async () => () => {} } as ToolContext
  const echo = () => manager.tools(new Set()).find((t) => t.spec.name === 'mcp__tester__echo')

  beforeAll(async () => {
    sb = makeSandbox()
    manager = new PluginManager(vault)
    await manager.start()
  })
  afterAll(async () => {
    await manager.stopAll()
    sb.cleanup()
  })

  it('previews, stores the pasted token in the keychain, and passes it to the server', async () => {
    const text = JSON.stringify({ mcpServers: { tester: { command: process.execPath, args: [MCP_SERVER], env: { TEST_FLAG: 'plain', SERVICE_TOKEN: 'tok-xyz' } } } })
    const preview = await manager.inspect({ kind: 'mcp', import: parseMcpImport(text) })
    expect(preview.plugin).toMatchObject({ id: 'tester', name: 'tester' })
    expect(preview.movedSecrets).toEqual(['SERVICE_TOKEN'])
    expect(preview.plugin.secrets).toEqual([{ name: 'SERVICE_TOKEN', isSet: true }])
    // Nothing is stored before the user confirms.
    expect(data.size).toBe(0)

    const list = await manager.install(preview.stagingId)
    expect(list[0].mcpServers[0]).toMatchObject({ status: 'running', toolCount: 3 })
    expect([...data.values()]).toEqual(['tok-xyz'])
    expect(JSON.stringify(list)).not.toContain('tok-xyz')
    expect((await echo()!.run({ text: 'hi' }, ctx)).text).toContain('TEST_FLAG=plain')
  })

  it('a server missing a secret waits, then starts once the secret is filled in', async () => {
    const text = JSON.stringify({ mcpServers: { tester: { command: process.execPath, args: [MCP_SERVER], env: { TEST_FLAG: '${FLAG_VALUE}' } } } })
    const preview = await manager.inspect({ kind: 'mcp', import: parseMcpImport(text) })
    expect(preview.replaces).toBe('tester')
    const list = await manager.install(preview.stagingId)
    expect(list[0].mcpServers[0]).toMatchObject({ status: 'error' })
    expect(list[0].mcpServers[0].error).toContain('FLAG_VALUE')

    manager.setSecret('tester', 'FLAG_VALUE', 'from-keychain')
    for (let i = 0; i < 100 && manager.list()[0].mcpServers[0].status !== 'running'; i++) await new Promise((r) => setTimeout(r, 50))
    expect(manager.list()[0].mcpServers[0].status).toBe('running')
    expect((await echo()!.run({ text: 'hi' }, ctx)).text).toContain('TEST_FLAG=from-keychain')
  })
})
