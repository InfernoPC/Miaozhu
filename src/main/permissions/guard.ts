import { app } from 'electron'
import { realpathSync } from 'node:fs'
import { appendFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PermissionDecision, PermissionRequest } from '@shared/types'
import { displayPath, expandPath, isInside, realPath } from '../tools/paths'
import type { ToolDef } from '../tools/types'

const home = () => app.getPath('home')

/** Never readable or writable, whatever the user allows: credentials, browser data, our own secrets. */
export function blockedRoots(): string[] {
  const h = home()
  const common = ['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gh', '.netrc', '.npmrc', '.git-credentials'].map((p) => join(h, p))
  const mac = [
    'Library/Keychains',
    'Library/Cookies',
    'Library/Safari',
    'Library/Messages',
    'Library/Mail',
    'Library/Application Support/Google/Chrome',
    'Library/Application Support/Microsoft Edge',
    'Library/Application Support/BraveSoftware',
    'Library/Application Support/Firefox',
    'Library/Application Support/com.apple.TCC'
  ].map((p) => join(h, p))
  const win = [
    'AppData/Local/Google/Chrome/User Data',
    'AppData/Local/Microsoft/Edge/User Data',
    'AppData/Local/BraveSoftware',
    'AppData/Roaming/Mozilla',
    'AppData/Local/Microsoft/Credentials',
    'AppData/Roaming/Microsoft/Credentials',
    'AppData/Roaming/Microsoft/Protect'
  ].map((p) => join(h, p))
  return [...common, ...(process.platform === 'darwin' ? mac : process.platform === 'win32' ? win : []), app.getPath('userData')]
}

/** System locations that may be read but never written. */
function writeBlockedRoots(): string[] {
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows'
    return [sys, process.env.ProgramFiles ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)']
  }
  return ['/System', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/Library', '/Applications', '/opt/homebrew/bin']
}

/**
 * A root in both spellings: as written and with symlinks resolved. Paths being checked are
 * resolved (so a link can't smuggle access), so roots must be too — e.g. macOS /var → /private/var,
 * or a Windows junction — otherwise a blocked root would never match.
 */
function bothSpellings(roots: string[]): string[] {
  return [...new Set(roots.flatMap((r) => {
    try {
      return [r, realpathSync.native(r)]
    } catch {
      return [r]
    }
  }))]
}

export type AskUser = (req: Omit<PermissionRequest, 'id'>) => Promise<PermissionDecision>

export type Verdict = { allowed: true; asked: boolean } | { allowed: false; reason: string; byUser: boolean }

/**
 * Decides whether a tool call may run (DESIGN.md §4.6): hard blocks first, then reads inside
 * allowed folders and ordinary network calls pass, everything else asks the user.
 * "Allow for this conversation" grants last until the conversation is cleared.
 */
export class PermissionGuard {
  private sessionTools = new Set<string>()
  private sessionReadRoots: string[] = []
  private blocked = bothSpellings(blockedRoots())
  private writeBlocked = bothSpellings(writeBlockedRoots())

  constructor(
    private allowedFolders: () => string[],
    private ask: AskUser
  ) {}

  resetSession(): void {
    this.sessionTools.clear()
    this.sessionReadRoots = []
  }

  /** For files the user dropped on the cat: reading them needs no further confirmation. */
  allowReadForSession(abs: string): void {
    this.sessionReadRoots.push(abs)
  }

  isBlocked = (abs: string): boolean => this.blocked.some((b) => isInside(abs, b))

  async authorize(tool: ToolDef, input: Record<string, unknown>): Promise<Verdict> {
    const accesses = await Promise.all(
      (tool.paths?.(input) ?? []).map(async (a) => ({ ...a, real: await realPath(expandPath(a.path)) }))
    )
    for (const a of accesses) {
      if (this.isBlocked(a.real)) return { allowed: false, byUser: false, reason: `${displayPath(a.real)} 屬於受保護的位置（帳號憑證、瀏覽器資料等），一律不允許存取` }
      if (a.access === 'write' && this.writeBlocked.some((b) => isInside(a.real, b))) {
        return { allowed: false, byUser: false, reason: `${displayPath(a.real)} 是系統資料夾，不允許修改` }
      }
    }

    let reason: string | undefined
    if (tool.risk === 'read') {
      const roots = bothSpellings([...this.allowedFolders().map(expandPath), ...this.sessionReadRoots])
      const outside = accesses.find((a) => !roots.some((r) => isInside(a.real, r)))
      if (!outside) return { allowed: true, asked: false }
      reason = `${displayPath(outside.real)} 不在允許讀取的資料夾清單中`
    } else if (tool.risk === 'network') {
      reason = tool.askReason?.(input)
      if (!reason) return { allowed: true, asked: false }
    } else if (this.sessionTools.has(tool.spec.name)) {
      return { allowed: true, asked: false }
    }

    const decision = await this.ask({
      toolName: tool.spec.name,
      risk: tool.risk,
      title: tool.title(input),
      detail: (await tool.detail?.(input)) ?? accesses.map((a) => displayPath(a.real)).join('\n'),
      reason
    })
    if (decision === 'deny') return { allowed: false, byUser: true, reason: '使用者拒絕了這個操作' }
    if (decision === 'session') {
      if (tool.risk === 'read') {
        // Grant the folder, not just the file, so follow-up reads nearby don't ask again.
        for (const a of accesses) {
          const isDir = (await stat(a.real).catch(() => null))?.isDirectory()
          this.sessionReadRoots.push(isDir ? a.real : dirname(a.real))
        }
      } else {
        this.sessionTools.add(tool.spec.name)
      }
    }
    return { allowed: true, asked: true }
  }
}

/** Append-only JSONL log of every tool call, for the user to review (設定 → 操作紀錄). */
export const auditLogPath = () => join(app.getPath('userData'), 'audit.log')

export async function audit(entry: {
  tool: string
  input: Record<string, unknown>
  verdict: 'auto' | 'approved' | 'denied' | 'blocked'
  ok?: boolean
  summary?: string
}): Promise<void> {
  // Keep the log readable: long contents (e.g. write_file bodies) are cut.
  const input = Object.fromEntries(
    Object.entries(entry.input).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v])
  )
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry, input }) + '\n'
  await appendFile(auditLogPath(), line, { mode: 0o600 }).catch(() => {})
}
