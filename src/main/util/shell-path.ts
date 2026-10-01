import { execFile } from 'node:child_process'
import { delimiter } from 'node:path'

/**
 * Apps opened from Finder/Dock get a bare PATH (/usr/bin:/bin:…) without Homebrew, nvm or
 * Volta, so MCP servers started with `npx` or `uvx` would not be found. Ask the user's login
 * shell for its PATH once at startup and merge it in. Windows GUI apps inherit the full PATH.
 */
export async function adoptLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/zsh'
  const marker = '__MIAOZHU_PATH__'
  const out = await new Promise<string>((resolve) => {
    execFile(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], { timeout: 5000 }, (err, stdout) => resolve(err ? '' : stdout))
  })
  const found = out.split(marker)[1]
  if (!found) return
  const merged = [...new Set([...found.split(delimiter), ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean))]
  process.env.PATH = merged.join(delimiter)
}
