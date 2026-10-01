import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Agent, type AgentSettings } from '../src/main/agent/agent'
import { describeError } from '../src/main/providers'
import { ClaudeProvider, toClaudeMessages } from '../src/main/providers/claude'
import type { AgentEvent, ChatMessage, ProviderProfile } from '@shared/types'
import { MockClaude, type ClaudeStep } from './helpers/mock-claude'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
const claude = new MockClaude()
let profile: ProviderProfile

beforeAll(async () => {
  profile = { id: 'c', name: 'Claude', kind: 'claude', baseURL: await claude.start(), model: 'claude-opus-5-5' }
})
afterAll(() => claude.stop())
beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
})

function agentFor(p: ProviderProfile = profile) {
  const settings: AgentSettings = {
    activeProfile: () => p,
    getApiKey: () => 'sk-ant-test',
    allowedFolders: () => [sb.path('Documents')],
    searchCredentials: () => ({ config: { provider: 'none' } }),
    persona: () => undefined,
    places: () => [],
    sensitiveFolders: () => [],
    localProfile: () => null
  }
  let end: ChatMessage | undefined
  const agent = new Agent(settings, (e: AgentEvent) => {
    if (e.type === 'turn-end') end = e.message
  })
  const turn = async (script: ClaudeStep[], text = 'go', attachments: string[] = []) => {
    claude.reset(script)
    await agent.send(text, attachments)
    return end!
  }
  return { agent, turn }
}

describe('Claude requests', () => {
  it('sends the system prompt separately, with caching, fallbacks, adaptive thinking and explicit effort', async () => {
    const { turn } = agentFor()
    const m = await turn([{ thinking: '想一下', text: '你好喵' }], '嗨')
    const { body, headers } = claude.requests[0]
    expect(m.text).toBe('你好喵')
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' }
    })
    expect(body.system).toContain('喵助')
    expect(body.messages.every((x: any) => x.role !== 'system')).toBe(true)
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(body.tools[0]).toMatchObject({ eager_input_streaming: true })
    expect(body.tools[0].input_schema.type).toBe('object')
  })

  it('runs tools and replays the previous step verbatim, thinking block and signature included', async () => {
    const { turn } = agentFor()
    const m = await turn([{ thinking: '先列資料夾', tools: [{ name: 'list_dir', args: { path: '~/Documents' } }] }, { text: '有 notes.txt' }])
    expect(m.text).toBe('有 notes.txt')
    const second = claude.requests[1].body.messages
    const assistant = second[second.length - 2]
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: '先列資料夾', signature: 'sig-1' })
    expect(assistant.content[1]).toMatchObject({ type: 'tool_use', name: 'list_dir', input: { path: '~/Documents' } })
    const results = second[second.length - 1]
    expect(results.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: assistant.content[1].id })
    expect(results.content[0].content).toContain('notes.txt')
  })

  it('answers parallel tool calls in one user message', async () => {
    const { turn } = agentFor()
    await turn([{ tools: [{ name: 'list_dir', args: { path: '~/Documents' } }, { name: 'read_file', args: { path: '~/Documents/notes.txt' } }] }, { text: 'ok' }])
    const last = claude.requests[1].body.messages.at(-1)
    expect(last.role).toBe('user')
    expect(last.content.map((c: any) => c.type)).toEqual(['tool_result', 'tool_result'])
  })

  it('sends dropped images as base64 image blocks', async () => {
    const { turn } = agentFor()
    await turn([{ text: '一張圖' }], '這是什麼', [sb.path('Documents', 'photo.png')])
    const user = claude.requests[0].body.messages[0]
    expect(user.content.find((c: any) => c.type === 'image')).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } })
  })

  it('reports a refusal clearly and does not run tools from that turn', async () => {
    const { turn } = agentFor()
    const m = await turn([{ tools: [{ name: 'run_command', args: { command: 'echo hi' } }], stop: 'refusal', explanation: 'policy' }])
    expect(m.error).toContain('拒絕')
    expect(claude.requests).toHaveLength(1)
  })

  it('records which model actually answered (e.g. a server-side fallback)', async () => {
    const { turn } = agentFor()
    expect((await turn([{ text: 'hi', servedBy: 'claude-opus-4-8' }])).model).toBe('claude-opus-4-8')
  })

  it('moves to a fallback model when overloaded', async () => {
    const { turn } = agentFor({ ...profile, fallbackModels: ['claude-sonnet-5-5'] })
    const m = await turn([{ status: 529 }, { text: '備用模型回答' }])
    expect(claude.requests.map((r) => r.body.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(m.text).toBe('備用模型回答')
  })

  it('explains API errors in plain words', async () => {
    const p = new ClaudeProvider(profile, 'k')
    claude.reset([{ status: 529 }, { status: 529 }])
    let err: unknown
    try {
      for await (const _ of p.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) void _
    } catch (e) {
      err = e
    }
    expect(describeError(err)).toContain('稍後再試')
  })
})

describe('converting other providers\' history', () => {
  it('rebuilds turns from another provider as text and tool_use blocks', () => {
    const { system, messages } = toClaudeMessages(
      [
        { role: 'system', text: 'SYS' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', text: '我來看看', toolCalls: [{ id: 'call_1', name: 'list_dir', arguments: '{"path":"~"}' }] },
        { role: 'tool', toolCallId: 'call_1', text: '結果' },
        { role: 'assistant', text: '完成' }
      ],
      'claude-opus-5-5'
    )
    expect(system).toBe('SYS')
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[1].content).toEqual([
      { type: 'text', text: '我來看看' },
      { type: 'tool_use', id: 'call_1', name: 'list_dir', input: { path: '~' } }
    ])
  })

  it('does not replay another Claude model\'s raw thinking blocks', () => {
    const raw = { kind: 'claude' as const, model: 'claude-sonnet-5-5', content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'hi' }] }
    const { messages } = toClaudeMessages([{ role: 'user', content: [{ type: 'text', text: 'q' }] }, { role: 'assistant', text: 'hi', providerData: raw }], 'claude-opus-5-5')
    expect(messages[1].content).toEqual([{ type: 'text', text: 'hi' }])
  })
})
