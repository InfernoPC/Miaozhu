import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findTool, parseArgs, ToolError } from '../src/main/tools'
import type { ToolContext } from '../src/main/tools/types'
import { htmlToText, searchWeb } from '../src/main/tools/web'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
beforeAll(() => {
  sb = makeSandbox()
  symlinkSync(sb.path('.ssh', 'id_rsa'), sb.path('Documents', 'innocent.txt'))
})
afterAll(() => sb.cleanup())

const ctx: ToolContext = {
  signal: new AbortController().signal,
  search: () => ({ config: { provider: 'none' } }),
  isBlocked: (p) => p.includes('.ssh'),
  hidePet: async () => () => {}
}
const run = (name: string, input: Record<string, unknown>) => findTool(name)!.run(input, ctx)

describe('parseArgs', () => {
  const read = findTool('read_file')!
  const list = findTool('list_dir')!

  it('rejects missing required fields with a message the model can act on', () => {
    expect(() => parseArgs(read, '{}')).toThrow('缺少必要參數：path')
  })
  it('rejects invalid JSON', () => {
    expect(() => parseArgs(read, '{"path": ')).toThrow(ToolError)
  })
  it('coerces numbers and booleans sent as strings (common with small models)', () => {
    expect(parseArgs(list, '{"path":"~","depth":"2","show_hidden":"true"}')).toEqual({ path: '~', depth: 2, show_hidden: true })
  })
  it('treats empty arguments as {} for tools with no required fields', () => {
    expect(parseArgs(findTool('screenshot')!, '')).toEqual({})
  })
})

describe('file tools', () => {
  it('lists a folder, skipping hidden and blocked entries', async () => {
    const r = await run('list_dir', { path: '~' })
    expect(r.text).toContain('Documents/')
    expect(r.text).not.toContain('.ssh')
  })

  it('reads text files', async () => {
    expect((await run('read_file', { path: '~/Documents/notes.txt' })).text).toContain('週五交報告')
  })

  it('extracts text from PDFs', async () => {
    expect((await run('read_file', { path: '~/Documents/report.pdf' })).text).toContain('Quarterly revenue grew 12 percent')
  })

  it('returns images as attachments for the model', async () => {
    const r = await run('read_file', { path: '~/Documents/photo.png' })
    expect(r.images?.[0]).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('finds files by name and by content', async () => {
    expect((await run('search_files', { path: '~/Documents', name: '*.pdf' })).text).toContain('report.pdf')
    const byContent = await run('search_files', { path: '~/Documents', contains: '週五' })
    expect(byContent.text).toContain('notes.txt')
  })

  it('content search does not follow a symlink into a protected file', async () => {
    const r = await run('search_files', { path: '~/Documents', contains: 'SECRET' })
    expect(r.text).toContain('沒有找到')
  })

  it('writes files, creating parent folders', async () => {
    await run('write_file', { path: '~/Documents/new/sub/summary.md', content: '# 摘要' })
    expect(readFileSync(sb.path('Documents/new/sub/summary.md'), 'utf8')).toBe('# 摘要')
  })

  it('moves files into an existing folder and refuses to overwrite', async () => {
    await run('write_file', { path: '~/Desktop/move-me.txt', content: '1' })
    await run('move_file', { source: '~/Desktop/move-me.txt', destination: '~/Documents' })
    expect(existsSync(sb.path('Documents/move-me.txt'))).toBe(true)
    await run('write_file', { path: '~/Desktop/move-me.txt', content: '2' })
    await expect(run('move_file', { source: '~/Desktop/move-me.txt', destination: '~/Documents' })).rejects.toThrow('已存在')
  })

  it('deletes by moving to the trash, never permanently', async () => {
    await run('delete_file', { path: '~/Desktop/trash-me.txt' })
    expect(existsSync(sb.path('Desktop/trash-me.txt'))).toBe(false)
    expect(existsSync(sb.path('.Trash/trash-me.txt'))).toBe(true)
  })
})

describe.skipIf(process.platform === 'win32')('run_command', () => {
  it('runs in the home folder and returns UTF-8 output', async () => {
    const r = await run('run_command', { command: 'echo 喵喵 && pwd' })
    expect(r.text).toContain('喵喵')
    expect(r.text).toContain(sb.home.split('/').pop())
  })

  it('stops commands that run past the timeout', async () => {
    const r = await run('run_command', { command: 'sleep 5', timeout_seconds: 1 })
    expect(r.text).toContain('強制停止')
  })
})

describe('web', () => {
  it('turns HTML into readable text without scripts or navigation', () => {
    const { title, text } = htmlToText(
      '<html><head><title>標題 &amp; 測試</title><script>evil()</script></head><body><nav>menu</nav><h2>重點</h2><p>第一段</p><ul><li>一</li><li>二</li></ul></body></html>'
    )
    expect(title).toBe('標題 & 測試')
    expect(text).toContain('## 重點')
    expect(text).toContain('- 一')
    expect(text).not.toContain('evil')
    expect(text).not.toContain('menu')
  })

  it('reads Google results via Serper, with the direct answer first', async () => {
    const realFetch = globalThis.fetch
    let sent: any
    globalThis.fetch = (async (url: string, init: any) => {
      sent = { url, key: init.headers['x-api-key'], body: JSON.parse(init.body) }
      return new Response(
        JSON.stringify({
          answerBox: { title: '台北天氣', answer: '28°C，晴' },
          organic: [{ title: '中央氣象署', link: 'https://www.cwa.gov.tw', snippet: '預報' }]
        })
      )
    }) as typeof fetch
    try {
      const hits = await searchWeb('台北 天氣', 5, { config: { provider: 'serper' }, apiKey: 'k' }, new AbortController().signal)
      expect(sent).toMatchObject({ url: 'https://google.serper.dev/search', key: 'k', body: { q: '台北 天氣', gl: 'tw', hl: 'zh-tw' } })
      expect(hits.map((h) => h.snippet)).toEqual(['28°C，晴', '預報'])
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('explains how to set up search when none is configured', async () => {
    await expect(searchWeb('x', 5, { config: { provider: 'none' } }, new AbortController().signal)).rejects.toThrow('網路搜尋')
  })
})
