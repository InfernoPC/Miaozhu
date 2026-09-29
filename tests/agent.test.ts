import { existsSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Agent, type AgentSettings } from '../src/main/agent/agent'
import type { AgentEvent, ChatMessage, PermissionDecision, PermissionRequest } from '@shared/types'
import { MockLLM, type Step } from './helpers/mock-llm'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
let llm: MockLLM
let baseURL: string

beforeAll(async () => {
  sb = makeSandbox()
  llm = new MockLLM()
  baseURL = await llm.start()
})
afterAll(async () => {
  await llm.stop()
  sb.cleanup()
})

/** Agent wired to the mock model; `answer` decides every permission prompt (null = never answer). */
function setup(answer: (req: PermissionRequest) => PermissionDecision | null = () => 'once') {
  const settings: AgentSettings = {
    activeProfile: () => ({ id: 'p', name: 'mock', kind: 'openai-compatible', baseURL, model: 'mock-model' }),
    getApiKey: () => 'k',
    allowedFolders: () => [sb.path('Documents'), sb.path('Desktop')],
    searchCredentials: () => ({ config: { provider: 'none' } }),
    persona: () => undefined
  }
  const events: AgentEvent[] = []
  const prompts: PermissionRequest[] = []
  const agent: Agent = new Agent(settings, (e) => {
    events.push(e)
    if (e.type === 'permission-request') {
      prompts.push(e.request)
      const d = answer(e.request)
      if (d) setTimeout(() => agent.respondPermission(e.request.id, d), 5)
    }
  })
  const turn = async (script: Step[], text = 'go', attachments: string[] = []): Promise<ChatMessage> => {
    llm.reset(script)
    events.length = 0
    prompts.length = 0
    await agent.send(text, attachments)
    return (events.find((e) => e.type === 'turn-end') as Extract<AgentEvent, { type: 'turn-end' }>).message
  }
  const tools = (m: ChatMessage) => (m.parts ?? []).flatMap((p) => (p.type === 'tool' ? [p.tool] : []))
  return { agent, events, prompts, turn, tools }
}

describe('tool loop', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  it('runs a tool, feeds the result back, and finishes with text', async () => {
    const m = await t.turn([{ tool: 'list_dir', args: { path: '~/Documents' } }, { text: '有兩個檔案喵' }])
    expect(llm.requests[0].tools.length).toBeGreaterThan(5)
    expect(llm.toolResult(1)).toContain('notes.txt')
    expect(t.tools(m)[0]).toMatchObject({ name: 'list_dir', status: 'done' })
    expect(m.text).toContain('有兩個檔案')
    expect(t.prompts).toEqual([])
  })

  it('keeps text and tool calls in the order they happened', async () => {
    const m = await t.turn([{ tool: 'list_dir', args: { path: '~/Documents' } }, { text: '好了' }])
    expect(m.parts?.map((p) => p.type)).toEqual(['tool', 'text'])
  })

  it('reports bad arguments back to the model instead of failing', async () => {
    await t.turn([{ tool: 'read_file', args: {} }, { text: 'oops' }])
    expect(llm.toolResult(1)).toContain('缺少必要參數')
  })

  it('tells the model about unknown tools', async () => {
    await t.turn([{ tool: 'launch_rocket', args: {} }, { text: 'no' }])
    expect(llm.toolResult(1)).toContain('沒有名為 launch_rocket 的工具')
  })

  it('falls back to plain chat when the model rejects tools', async () => {
    const m = await t.turn([{ status: 404, message: 'No endpoints found that support tool use.' }, { text: '我只能聊天' }])
    expect(m.text).toContain('我只能聊天')
    expect(llm.requests[1].tools).toBeUndefined()
  })
})

describe('permissions in the loop', () => {
  it('writes after approval', async () => {
    const t = setup(() => 'once')
    await t.turn([{ tool: 'write_file', args: { path: '~/Documents/out.md', content: 'ok' } }, { text: 'done' }])
    expect(t.prompts.map((p) => p.risk)).toEqual(['write'])
    expect(readFileSync(sb.path('Documents/out.md'), 'utf8')).toBe('ok')
  })

  it('leaves files alone when the user refuses, and tells the model', async () => {
    const t = setup(() => 'deny')
    const m = await t.turn([{ tool: 'delete_file', args: { path: '~/Desktop/trash-me.txt' } }, { text: '好的' }])
    expect(existsSync(sb.path('Desktop/trash-me.txt'))).toBe(true)
    expect(llm.toolResult(1)).toContain('拒絕')
    expect(t.tools(m)[0].status).toBe('denied')
  })

  it('never sends protected file contents to the model', async () => {
    const t = setup(() => 'once')
    await t.turn([{ tool: 'read_file', args: { path: '~/.ssh/id_rsa' } }, { text: 'x' }])
    expect(t.prompts).toEqual([])
    expect(llm.sentText).not.toContain('SECRET-KEY')
  })

  it('stopping while a confirmation is open ends the turn and withdraws the question', async () => {
    const t = setup(() => null)
    setTimeout(() => t.agent.cancel(), 200)
    await t.turn([{ tool: 'write_file', args: { path: '~/Documents/never.txt', content: 'x' } }, { text: 'no' }])
    expect(existsSync(sb.path('Documents/never.txt'))).toBe(false)
    expect(t.agent.pendingPermissions()).toEqual([])
    expect(t.events.some((e) => e.type === 'permission-resolved')).toBe(true)
  })

  it('clearing the conversation also revokes "allow for this conversation"', async () => {
    const t = setup(() => 'session')
    await t.turn([{ tool: 'run_command', args: { command: 'echo 1' } }, { text: 'a' }])
    await t.turn([{ tool: 'run_command', args: { command: 'echo 2' } }, { text: 'b' }])
    expect(t.prompts).toEqual([])
    t.agent.clear()
    await t.turn([{ tool: 'run_command', args: { command: 'echo 3' } }, { text: 'c' }])
    expect(t.prompts).toHaveLength(1)
  })
})

describe('attachments', () => {
  it('inlines dropped file contents into the message', async () => {
    const t = setup()
    await t.turn([{ text: 'ok' }], '摘要', [sb.path('Other', 'a.txt')])
    expect(llm.sentText).toContain('outside A')
    const start = t.events.find((e) => e.type === 'turn-start') as Extract<AgentEvent, { type: 'turn-start' }>
    expect(start.userMessage.attachments?.[0]).toMatchObject({ name: 'a.txt', kind: 'file' })
  })

  it('sends dropped images as image content', async () => {
    const t = setup()
    await t.turn([{ text: 'ok' }], '這是什麼', [sb.path('Documents', 'photo.png')])
    const user = llm.requests[0].messages.filter((m: any) => m.role === 'user').pop()
    expect(user.content.some((c: any) => c.type === 'image_url')).toBe(true)
  })

  it('refuses to read a dropped protected file', async () => {
    const t = setup()
    await t.turn([{ text: 'ok' }], '看這個', [sb.path('.ssh', 'id_rsa')])
    expect(llm.sentText).not.toContain('SECRET-KEY')
    expect(llm.sentText).toContain('受保護')
  })
})

describe('audit log', () => {
  it('records automatic, approved, denied and blocked calls', async () => {
    const allow = setup(() => 'once')
    await allow.turn([{ tool: 'list_dir', args: { path: '~/Documents' } }, { text: 'a' }])
    await allow.turn([{ tool: 'write_file', args: { path: '~/Documents/log.md', content: 'x' } }, { text: 'b' }])
    await allow.turn([{ tool: 'read_file', args: { path: '~/.ssh/id_rsa' } }, { text: 'c' }])
    await setup(() => 'deny').turn([{ tool: 'delete_file', args: { path: '~/Documents/log.md' } }, { text: 'd' }])
    // Audit writes are fire-and-forget; give them a moment to land.
    await new Promise((r) => setTimeout(r, 100))
    const log = readFileSync(sb.path('.app-data', 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(new Set(log.map((l) => l.verdict))).toEqual(new Set(['auto', 'approved', 'blocked', 'denied']))
  })
})
