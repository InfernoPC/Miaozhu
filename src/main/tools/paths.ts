import { app } from 'electron'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const home = () => app.getPath('home')
const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32'

/** Resolves ~, relative paths (against home) and normalises separators. */
export function expandPath(p: string): string {
  const trimmed = p.trim().replace(/^["']|["']$/g, '')
  if (trimmed === '~') return home()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(home(), trimmed.slice(2))
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(home(), trimmed)
}

/** Follows symlinks so a link inside an allowed folder cannot point somewhere blocked. */
export async function realPath(abs: string): Promise<string> {
  try {
    return await realpath(abs)
  } catch {
    const parent = dirname(abs)
    if (parent === abs) return abs
    return join(await realPath(parent), basename(abs))
  }
}

export function isInside(child: string, parent: string): boolean {
  const c = caseInsensitive ? child.toLowerCase() : child
  const p = caseInsensitive ? parent.toLowerCase() : parent
  if (c === p) return true
  const rel = relative(p, c)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/** ~/Documents/a.txt instead of /Users/name/Documents/a.txt, for compact UI text. */
export function displayPath(abs: string): string {
  const h = home()
  return isInside(abs, h) ? (abs === h ? '~' : '~' + sep + relative(h, abs)) : abs
}
