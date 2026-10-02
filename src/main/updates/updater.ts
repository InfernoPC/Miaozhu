import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { UpdateStatus } from '@shared/types'

export const RELEASES = 'https://github.com/InfernoPC/Miaozhu/releases/latest/download'
const CHECK_EVERY_MS = 6 * 60 * 60_000
const FIRST_CHECK_AFTER_MS = 30_000
const FETCH_TIMEOUT_MS = 15_000

/** What a release publishes next to the installers. */
interface LatestJson {
  version: string
  notes?: string
  url?: string
}

/** Compares dotted versions numerically ("0.10.0" > "0.9.1"); a pre-release tag sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.trim().replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

/**
 * The command that updates in place: the same one-line install a colleague pastes, run
 * detached so it outlives this process. The script quits the app, replaces it and reopens it.
 */
export function installCommand(platform: NodeJS.Platform, exePath: string, base = RELEASES): { file: string; args: string[]; env: Record<string, string> } {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${base}/install.ps1 | iex`],
      env: {}
    }
  }
  // .../Miaozhu.app/Contents/MacOS/Miaozhu → the folder holding Miaozhu.app, so the update lands where the app is.
  const appDir = dirname(dirname(dirname(dirname(exePath))))
  return { file: '/bin/bash', args: ['-c', `curl -fsSL ${base}/install.sh | bash`], env: { MIAOZHU_APP_DIR: appDir } }
}

interface Options {
  currentVersion: string
  /** Only an installed build checks; a dev build would always look out of date. */
  enabled: boolean
  onAvailable: (status: UpdateStatus) => void
  base?: string
  fetch?: typeof fetch
}

/** Checks the latest GitHub release now and then; tells the UI once per new version. */
export class UpdateChecker {
  private status: UpdateStatus
  private timers: NodeJS.Timeout[] = []
  private announced?: string

  constructor(private opts: Options) {
    this.status = { current: opts.currentVersion, available: false }
  }

  get(): UpdateStatus {
    return this.status
  }

  start(): void {
    if (!this.opts.enabled) return
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_AFTER_MS))
    this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS))
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  async check(): Promise<UpdateStatus> {
    const base = this.opts.base ?? RELEASES
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await (this.opts.fetch ?? fetch)(`${base}/latest.json`, { signal: controller.signal, cache: 'no-store' })
      // No release published yet looks the same as "up to date".
      if (res.status === 404) return this.set({ current: this.opts.currentVersion, available: false, checkedAt: new Date().toISOString() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const latest = (await res.json()) as LatestJson
      if (typeof latest?.version !== 'string') throw new Error('版本資訊格式不對')
      const status: UpdateStatus = {
        current: this.opts.currentVersion,
        latest: latest.version,
        available: compareVersions(latest.version, this.opts.currentVersion) > 0,
        notes: typeof latest.notes === 'string' ? latest.notes.slice(0, 2000) : undefined,
        url: typeof latest.url === 'string' && latest.url.startsWith('https://') ? latest.url : undefined,
        checkedAt: new Date().toISOString()
      }
      this.set(status)
      if (status.available && this.announced !== status.latest) {
        this.announced = status.latest
        this.opts.onAvailable(status)
      }
      return status
    } catch (err) {
      const error = controller.signal.aborted ? '檢查逾時，請確認網路' : `檢查失敗：${(err as Error).message}`
      return this.set({ ...this.status, error, checkedAt: new Date().toISOString() })
    } finally {
      clearTimeout(timer)
    }
  }

  private set(status: UpdateStatus): UpdateStatus {
    this.status = status
    return status
  }
}

/** Starts the installer in the background; the caller quits the app right after. */
export function launchInstaller(platform: NodeJS.Platform, exePath: string, base?: string): void {
  const { file, args, env } = installCommand(platform, exePath, base)
  const child = spawn(file, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ...env }
  })
  child.unref()
}
