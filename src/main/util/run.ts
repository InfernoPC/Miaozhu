import spawn from 'cross-spawn'

/**
 * Runs a program without a shell and resolves with its stdout. On failure the error carries
 * the tail of stderr, which for git is usually the most useful line ("repository not found").
 */
export function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let out = ''
    let err = ''
    child.stdout?.on('data', (b: Buffer) => (out += b.toString()))
    child.stderr?.on('data', (b: Buffer) => (err = (err + b.toString()).slice(-1200)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
      reject(new Error(missing ? `找不到 ${bin}，請先安裝它` : `無法執行 ${bin}：${e.message}`))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(signal === 'SIGKILL' ? `${bin} 執行太久，已停止` : err.trim().split('\n').slice(-3).join('\n') || `${bin} 結束代碼 ${code}`))
    })
  })
}
