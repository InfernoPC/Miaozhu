import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Agent, type AgentSettings } from '../src/main/agent/agent'
import { ConversationStore } from '../src/main/agent/conversation-store'
import { MockLLM } from './helpers/mock-llm'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
let llm: MockLLM
let settings: AgentSettings

beforeAll(async () => {
  sb = makeSandbox()
  llm = new MockLLM()
  const baseURL = await llm.start()
  settings = {
    activeProfile: () => ({ id: 'p', name: 'mock', kind: 'openai-compatible', baseURL, model: 'mock-model' }),
    getApiKey: () => 'k',
    allowedFolders: () => [sb.path('Documents')],
    searchCredentials: () => ({ config: { provider: 'none' } }),
    persona: () => undefined,
    places: () => []
  }
})
afterAll(async () => {
  await llm.stop()
  sb.cleanup()
})

/** A fresh agent reading the same saved file, as after an app restart. */
const launch = () => new Agent(settings, () => {}, { hidePet: async () => () => {}, store: new ConversationStore() })
const file = () => sb.path('.app-data', 'conversation.json')

describe('saved conversations', () => {
  it('restores the chat and the model context after a restart', async () => {
    const first = launch()
    llm.reset([{ tool: 'list_dir', args: { path: '~/Documents' } }, { text: '記住了，你叫 Tim' }])
    await first.send('我叫 Tim')

    const second = launch()
    expect(second.getHistory().map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(second.getHistory()[1].text).toContain('記住了')

    llm.reset([{ text: '你叫 Tim' }])
    await second.send('我叫什麼？')
    const sent = llm.requests[0].messages.map((m: any) => m.role)
    // The earlier user message, the tool call and its result all come back into context.
    expect(sent).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
    expect(JSON.stringify(llm.requests[0].messages)).toContain('我叫 Tim')
  })

  it('does not save image data, only a note that there was one', async () => {
    const agent = launch()
    agent.clear()
    llm.reset([{ text: '是一張圖' }])
    await agent.send('這是什麼', [sb.path('Documents', 'photo.png')])
    const saved = readFileSync(file(), 'utf8')
    expect(saved).not.toContain('data:image')
    expect(saved).toContain('[圖片已省略]')
  })

  it('clearing the chat deletes the saved file', async () => {
    const agent = launch()
    llm.reset([{ text: 'hi' }])
    await agent.send('hello')
    expect(existsSync(file())).toBe(true)
    agent.clear()
    expect(existsSync(file())).toBe(false)
    expect(launch().getHistory()).toEqual([])
  })

  it('starts fresh instead of crashing when the file is corrupt', () => {
    writeFileSync(file(), '{ not json')
    expect(launch().getHistory()).toEqual([])
  })

  it('does not carry "allow for this conversation" grants across a restart', async () => {
    const asked: string[] = []
    const make = () =>
      new Agent(
        settings,
        (e) => {
          if (e.type === 'permission-request') {
            asked.push(e.request.risk)
            setTimeout(() => agent.respondPermission(e.request.id, 'session'), 5)
          }
        },
        { hidePet: async () => () => {}, store: new ConversationStore() }
      )
    let agent = make()
    llm.reset([{ tool: 'run_command', args: { command: 'echo 1' } }, { text: 'a' }])
    await agent.send('run')
    agent = make()
    llm.reset([{ tool: 'run_command', args: { command: 'echo 2' } }, { text: 'b' }])
    await agent.send('run again')
    expect(asked).toEqual(['execute', 'execute'])
  })
})
