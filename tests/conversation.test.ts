import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Agent, type AgentSettings } from '../src/main/agent/agent'
import { ConversationStore, titleFor } from '../src/main/agent/conversation-store'
import type { AgentEvent } from '@shared/types'
import { MockLLM } from './helpers/mock-llm'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
let llm: MockLLM
let baseURL: string

const settings = (): AgentSettings => ({
  activeProfile: () => ({ id: 'p', name: 'mock', kind: 'openai-compatible', baseURL, model: 'mock-model' }),
  getApiKey: () => 'k',
  allowedFolders: () => [sb.path('Documents')],
  searchCredentials: () => ({ config: { provider: 'none' } }),
  persona: () => undefined,
  places: () => [],
  sensitiveFolders: () => [],
  localProfile: () => null
})

beforeAll(async () => {
  llm = new MockLLM()
  baseURL = await llm.start()
})
beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
})
afterAll(async () => {
  await llm.stop()
  sb.cleanup()
})

/** A fresh agent on the same saved files, as after an app restart. */
function launch(onEvent: (e: AgentEvent, agent: Agent) => void = () => {}) {
  const store = new ConversationStore()
  const agent: Agent = new Agent(settings(), (e) => onEvent(e, agent), { hidePet: async () => () => {}, store })
  return { agent, store }
}

describe('saving and restoring', () => {
  it('restores the open conversation and its model context after a restart', async () => {
    const { agent } = launch()
    llm.reset([{ tool: 'list_dir', args: { path: '~/Documents' } }, { text: '記住了，你叫 Tim' }])
    await agent.send('我叫 Tim')

    const again = launch().agent
    expect(again.getHistory().map((m) => m.role)).toEqual(['user', 'assistant'])
    llm.reset([{ text: '你叫 Tim' }])
    await again.send('我叫什麼？')
    expect(llm.requests[0].messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
  })

  it('does not save image data, only a note that there was one', async () => {
    const { agent, store } = launch()
    llm.reset([{ text: '是一張圖' }])
    await agent.send('這是什麼', [sb.path('Documents', 'photo.png')])
    const file = sb.path('.app-data', 'conversations', `${store.current()}.json`)
    const saved = readFileSync(file, 'utf8')
    expect(saved).not.toContain('data:image')
    expect(saved).toContain('[圖片已省略]')
  })

  it('starts fresh instead of crashing when a file is corrupt', async () => {
    const { agent, store } = launch()
    llm.reset([{ text: 'hi' }])
    await agent.send('hello')
    writeFileSync(sb.path('.app-data', 'conversations', `${store.current()}.json`), '{ not json')
    expect(launch().agent.getHistory()).toEqual([])
  })

  it('moves the single pre-M4.2 conversation into the list', () => {
    writeFileSync(
      sb.path('.app-data', 'conversation.json'),
      JSON.stringify({ version: 1, history: [{ id: 'u', role: 'user', text: '舊的對話', createdAt: 0 }], turns: [] })
    )
    const { agent, store } = launch()
    expect(agent.getHistory()[0].text).toBe('舊的對話')
    expect(store.list().map((c) => c.title)).toEqual(['舊的對話'])
    expect(existsSync(sb.path('.app-data', 'conversation.json'))).toBe(false)
  })
})

describe('the conversation list', () => {
  it('keeps each conversation separate: history, model context and the list order', async () => {
    const { agent, store } = launch()
    llm.reset([{ text: 'A1' }])
    await agent.send('第一段：旅遊計畫')
    const first = agent.currentConversation()

    agent.newConversation()
    expect(agent.getHistory()).toEqual([])
    llm.reset([{ text: 'B1' }])
    await agent.send('第二段：報帳')
    // The second conversation's request carries none of the first one.
    expect(JSON.stringify(llm.requests[0].messages)).not.toContain('旅遊計畫')

    expect(store.list().map((c) => c.title)).toEqual(['第二段：報帳', '第一段：旅遊計畫'])
    agent.openConversation(first)
    expect(agent.getHistory().map((m) => m.text)).toEqual(['第一段：旅遊計畫', 'A1'])
  })

  it('does not save an empty new conversation', () => {
    const { agent, store } = launch()
    agent.newConversation()
    agent.newConversation()
    expect(store.list()).toEqual([])
  })

  it('renames, and keeps a custom title after more messages', async () => {
    const { agent, store } = launch()
    llm.reset([{ text: 'ok' }])
    await agent.send('隨便聊聊')
    store.rename(agent.currentConversation(), '  週會準備  ')
    llm.reset([{ text: 'ok' }])
    await agent.send('再一句')
    expect(store.list()[0].title).toBe('週會準備')
  })

  it('deleting the open conversation starts a new one; deleting another leaves it open', async () => {
    const { agent, store } = launch()
    llm.reset([{ text: 'a' }])
    await agent.send('留著')
    const keep = agent.currentConversation()
    agent.newConversation()
    llm.reset([{ text: 'b' }])
    await agent.send('刪掉')
    const drop = agent.currentConversation()

    agent.deleteConversation(keep)
    expect(agent.currentConversation()).toBe(drop)
    agent.deleteConversation(drop)
    expect(agent.getHistory()).toEqual([])
    expect(store.list()).toEqual([])
  })

  it('switching conversations revokes "allow for this conversation" grants', async () => {
    const asked: string[] = []
    const { agent } = launch((e, a) => {
      if (e.type === 'permission-request') {
        asked.push(e.request.risk)
        setTimeout(() => a.respondPermission(e.request.id, 'session'), 5)
      }
    })
    llm.reset([{ tool: 'run_command', args: { command: 'echo 1' } }, { text: 'a' }])
    await agent.send('run')
    llm.reset([{ tool: 'run_command', args: { command: 'echo 2' } }, { text: 'b' }])
    await agent.send('again')
    expect(asked).toHaveLength(1)
    agent.newConversation()
    llm.reset([{ tool: 'run_command', args: { command: 'echo 3' } }, { text: 'c' }])
    await agent.send('new chat')
    expect(asked).toHaveLength(2)
  })

  it('a reply still running when the user switches away is not written into the new conversation', async () => {
    const { agent, store } = launch((e, a) => {
      if (e.type === 'permission-request') setTimeout(() => a.respondPermission(e.request.id, 'once'), 5)
    })
    llm.reset([{ text: 'first' }])
    await agent.send('舊對話')
    const old = agent.currentConversation()
    // Start a slow turn, switch while it runs.
    llm.reset([{ tool: 'run_command', args: { command: 'sleep 1' } }, { text: 'late answer' }])
    const running = agent.send('慢慢做')
    await new Promise((r) => setTimeout(r, 150))
    agent.newConversation()
    await running
    expect(agent.getHistory()).toEqual([])
    expect(store.load(old)!.history.map((m) => m.text)).not.toContain('late answer')
  })

  it('titles come from the first message, or the dropped files', () => {
    expect(titleFor([{ id: '1', role: 'user', text: '  幫我\n整理   下載資料夾  ', createdAt: 0 }])).toBe('幫我 整理 下載資料夾')
    expect(titleFor([{ id: '1', role: 'user', text: '', createdAt: 0, attachments: [{ path: '/a/報價.pdf', name: '報價.pdf', kind: 'file' }] }])).toBe('報價.pdf')
    expect(titleFor([{ id: '1', role: 'user', text: '這是一段非常非常長的第一句話，會被截斷成適當的長度才不會太長', createdAt: 0 }])).toMatch(/…$/)
  })
})
