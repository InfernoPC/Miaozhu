import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { UpdateChecker, compareVersions, installCommand } from '../src/main/updates/updater'

/** A fetch that answers latest.json with the given body (or status). */
function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as typeof fetch
}

function checker(current: string, f: typeof fetch) {
  const announced: UpdateStatus[] = []
  const c = new UpdateChecker({ currentVersion: current, enabled: true, onAvailable: (s) => announced.push(s), base: 'https://example.test', fetch: f })
  return { c, announced }
}

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBe(1)
    expect(compareVersions('v1.2.0', '1.2')).toBe(0)
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('a pre-release comes before its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
  })
})

describe('update check', () => {
  it('reports a newer release and announces it only once', async () => {
    const { c, announced } = checker('0.1.0', fakeFetch({ version: '0.2.0', notes: '新增更新檢查', url: 'https://github.com/x/releases/tag/v0.2.0' }))
    const s = await c.check()
    expect(s).toMatchObject({ current: '0.1.0', latest: '0.2.0', available: true, notes: '新增更新檢查' })
    await c.check()
    expect(announced).toHaveLength(1)
    expect(c.get().available).toBe(true)
  })

  it('the same or an older release is not an update', async () => {
    expect((await checker('0.2.0', fakeFetch({ version: '0.2.0' })).c.check()).available).toBe(false)
    expect((await checker('0.3.0', fakeFetch({ version: '0.2.0' })).c.check()).available).toBe(false)
  })

  it('no release yet (404) is simply "up to date"', async () => {
    const s = await checker('0.1.0', fakeFetch('Not Found', 404)).c.check()
    expect(s.available).toBe(false)
    expect(s.error).toBeUndefined()
  })

  it('a broken answer or a network error is reported, not thrown', async () => {
    expect((await checker('0.1.0', fakeFetch('<html>')).c.check()).error).toContain('檢查失敗')
    expect((await checker('0.1.0', fakeFetch({ nope: 1 })).c.check()).error).toContain('格式不對')
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect((await checker('0.1.0', offline).c.check()).error).toContain('fetch failed')
  })

  it('ignores a release page that is not https', async () => {
    const s = await checker('0.1.0', fakeFetch({ version: '0.2.0', url: 'javascript:alert(1)' })).c.check()
    expect(s.url).toBeUndefined()
  })

  it('a dev build never schedules checks', () => {
    const c = new UpdateChecker({ currentVersion: '0.1.0', enabled: false, onAvailable: () => {} })
    c.start()
    expect((c as unknown as { timers: unknown[] }).timers).toHaveLength(0)
  })
})

describe('install command', () => {
  it('on macOS, reinstalls into the folder the app runs from', () => {
    const cmd = installCommand('darwin', '/Users/me/Applications/Miaozhu.app/Contents/MacOS/Miaozhu', 'https://example.test')
    expect(cmd.file).toBe('/bin/bash')
    expect(cmd.args).toEqual(['-c', 'curl -fsSL https://example.test/install.sh | bash'])
    expect(cmd.env.MIAOZHU_APP_DIR).toBe('/Users/me/Applications')
  })

  it('on Windows, runs the PowerShell installer', () => {
    const cmd = installCommand('win32', 'C:\\Users\\me\\AppData\\Local\\Programs\\Miaozhu\\Miaozhu.exe', 'https://example.test')
    expect(cmd.file).toBe('powershell.exe')
    expect(cmd.args.at(-1)).toBe('irm https://example.test/install.ps1 | iex')
  })
})
