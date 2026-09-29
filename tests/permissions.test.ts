import { symlinkSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PermissionGuard } from '../src/main/permissions/guard'
import { findTool } from '../src/main/tools'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
beforeAll(() => {
  sb = makeSandbox()
})
afterAll(() => sb.cleanup())

/** A guard whose "user" answers with the given decision and records what was asked. */
function guardAnswering(decision: 'once' | 'session' | 'deny') {
  const asked: string[] = []
  const guard = new PermissionGuard(
    () => [sb.path('Documents'), sb.path('Desktop')],
    async (req) => {
      asked.push(`${req.risk}:${req.title}`)
      return decision
    }
  )
  return { guard, asked }
}

const tool = (name: string) => findTool(name)!

describe('reads', () => {
  it('allows reads inside allowed folders without asking', async () => {
    const { guard, asked } = guardAnswering('deny')
    expect(await guard.authorize(tool('read_file'), { path: '~/Documents/notes.txt' })).toEqual({ allowed: true, asked: false })
    expect(asked).toEqual([])
  })

  it('asks before reading outside allowed folders', async () => {
    const { guard, asked } = guardAnswering('once')
    const v = await guard.authorize(tool('read_file'), { path: '~/Other/a.txt' })
    expect(v).toEqual({ allowed: true, asked: true })
    expect(asked).toHaveLength(1)
  })

  it('"allow for this conversation" covers the whole folder until reset', async () => {
    const { guard, asked } = guardAnswering('session')
    await guard.authorize(tool('read_file'), { path: '~/Other/a.txt' })
    await guard.authorize(tool('read_file'), { path: '~/Other/b.txt' })
    expect(asked).toHaveLength(1)
    guard.resetSession()
    await guard.authorize(tool('read_file'), { path: '~/Other/b.txt' })
    expect(asked).toHaveLength(2)
  })
})

describe('protected locations', () => {
  it('blocks ~/.ssh outright, without asking, even though the user would approve', async () => {
    const { guard, asked } = guardAnswering('once')
    const v = await guard.authorize(tool('read_file'), { path: '~/.ssh/id_rsa' })
    expect(v.allowed).toBe(false)
    expect(asked).toEqual([])
  })

  it('blocks a symlink inside an allowed folder that points into ~/.ssh', async () => {
    symlinkSync(sb.path('.ssh'), sb.path('Documents', 'sneaky'))
    const { guard } = guardAnswering('once')
    const v = await guard.authorize(tool('read_file'), { path: '~/Documents/sneaky/id_rsa' })
    expect(v.allowed).toBe(false)
  })

  it('never lets the app read its own settings and keys', async () => {
    const { guard } = guardAnswering('once')
    const v = await guard.authorize(tool('read_file'), { path: sb.path('.app-data', 'secrets.json') })
    expect(v.allowed).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('refuses to write into system folders', async () => {
    const { guard, asked } = guardAnswering('once')
    const v = await guard.authorize(tool('write_file'), { path: '/usr/local/evil.sh', content: 'x' })
    expect(v.allowed).toBe(false)
    expect(asked).toEqual([])
  })
})

describe('changes and commands', () => {
  it('asks for every write, even inside allowed folders', async () => {
    const { guard, asked } = guardAnswering('once')
    await guard.authorize(tool('write_file'), { path: '~/Documents/a.md', content: 'x' })
    await guard.authorize(tool('write_file'), { path: '~/Documents/b.md', content: 'x' })
    expect(asked).toHaveLength(2)
  })

  it('reports a user refusal as such', async () => {
    const { guard } = guardAnswering('deny')
    const v = await guard.authorize(tool('delete_file'), { path: '~/Desktop/trash-me.txt' })
    expect(v).toMatchObject({ allowed: false, byUser: true })
  })

  it('a session grant for one tool does not cover another', async () => {
    const { guard, asked } = guardAnswering('session')
    await guard.authorize(tool('run_command'), { command: 'echo 1' })
    await guard.authorize(tool('run_command'), { command: 'echo 2' })
    await guard.authorize(tool('delete_file'), { path: '~/Desktop/trash-me.txt' })
    expect(asked.map((a) => a.split(':')[0])).toEqual(['execute', 'write'])
  })
})

describe('network', () => {
  it('lets public web pages through but asks for intranet addresses', async () => {
    const { guard, asked } = guardAnswering('once')
    await guard.authorize(tool('web_fetch'), { url: 'https://example.com' })
    expect(asked).toEqual([])
    for (const url of ['http://192.168.1.1/admin', 'http://intranet/wiki', 'http://localhost:8080', 'https://wiki.corp']) {
      await guard.authorize(tool('web_fetch'), { url })
    }
    expect(asked).toHaveLength(4)
  })
})
