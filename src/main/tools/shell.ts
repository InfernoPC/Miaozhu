import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { displayPath, expandPath } from './paths'
import { ToolError, type ToolDef } from './types'

const MAX_OUTPUT = 20_000
const DEFAULT_TIMEOUT_S = 60
const MAX_TIMEOUT_S = 300

const isWin = process.platform === 'win32'
export const shellName = isWin ? 'PowerShell' : 'zsh'

function shellCommand(command: string): [string, string[]] {
  if (isWin) {
    // Force UTF-8 so Chinese output isn't garbled by the console code page.
    const utf8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; '
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8 + command]]
  }
  // Login shell so PATH includes Homebrew etc., like the user's own terminal.
  return [process.env.SHELL || '/bin/zsh', ['-l', '-c', command]]
}

function killTree(pid: number): void {
  try {
    if (isWin) spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
    else process.kill(-pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const runCommand: ToolDef = {
  spec: {
    name: 'run_command',
    description: `在使用者電腦上執行 ${shellName} 指令並回傳輸出。每次都需要使用者確認。不支援需要互動輸入的指令。`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要執行的指令' },
        cwd: { type: 'string', description: '工作目錄，預設為家目錄' },
        timeout_seconds: { type: 'integer', description: `逾時秒數，預設 ${DEFAULT_TIMEOUT_S}，最多 ${MAX_TIMEOUT_S}` }
      },
      required: ['command']
    }
  },
  risk: 'execute',
  title: (i) => `執行指令：${str(i.command).slice(0, 80)}`,
  detail: (i) => `$ ${str(i.command)}\n\n工作目錄：${displayPath(expandPath(str(i.cwd) || '~'))}（${shellName}）`,
  async run(i, ctx) {
    const cwd = expandPath(str(i.cwd) || '~')
    if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new ToolError(`工作目錄不存在：${displayPath(cwd)}`)
    const timeout = Math.min(MAX_TIMEOUT_S, Math.max(1, Number(i.timeout_seconds) || DEFAULT_TIMEOUT_S)) * 1000
    const [bin, args] = shellCommand(str(i.command))

    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, detached: !isWin, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let truncated = false
      const collect = (buf: Buffer) => {
        if (out.length >= MAX_OUTPUT) return void (truncated = true)
        out += buf.toString('utf8')
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)

      let reason: string | null = null
      const stop = (why: string) => {
        reason = why
        if (child.pid) killTree(child.pid)
      }
      const timer = setTimeout(() => stop(`超過 ${timeout / 1000} 秒，已強制停止`), timeout)
      const onAbort = () => stop('已取消')
      ctx.signal.addEventListener('abort', onAbort, { once: true })

      child.on('error', (err) => {
        clearTimeout(timer)
        reject(new ToolError(`無法執行指令：${err.message}`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        ctx.signal.removeEventListener('abort', onAbort)
        const body = (out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) : out).trimEnd()
        const tail = truncated || out.length > MAX_OUTPUT ? '\n…（輸出過長，已截斷）' : ''
        const status = reason ?? `結束代碼 ${code}`
        resolve({
          text: `${status}\n${body ? `輸出：\n${body}${tail}` : '（沒有輸出）'}`,
          summary: reason ?? (code === 0 ? '完成' : `結束代碼 ${code}`)
        })
      })
    })
  }
}
