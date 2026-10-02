import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `rm -rf` that also works on Windows when the tree holds read-only files — git makes its
 * object files read-only, so every cloned plugin or marketplace has them, and Node's rmSync
 * fails on those with EPERM there. Retries a few times for files briefly held by antivirus.
 */
export function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 })
  } catch (err) {
    // Windows reports a read-only file as EPERM; elsewhere a read-only folder leaves it
    // non-empty (ENOTEMPTY) or refuses outright (EACCES).
    const code = (err as NodeJS.ErrnoException).code
    if (!['EPERM', 'EACCES', 'ENOTEMPTY'].includes(code ?? '')) throw err
    makeWritable(path)
    rmSync(path, { recursive: true, force: true, maxRetries: 3 })
  }
}

function makeWritable(path: string): void {
  let st
  try {
    st = lstatSync(path)
  } catch {
    return
  }
  if (st.isSymbolicLink()) return
  try {
    chmodSync(path, st.isDirectory() ? 0o777 : 0o666)
  } catch {
    // Keep going: the retry reports whatever is still stuck.
  }
  if (st.isDirectory()) for (const name of readdirSync(path)) makeWritable(join(path, name))
}
