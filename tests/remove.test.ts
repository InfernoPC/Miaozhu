import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { removeDir } from '../src/main/util/remove'
import { makeSandbox } from './helpers/sandbox'

const sb = makeSandbox()
afterAll(() => sb.cleanup())

describe('removeDir', () => {
  it('removes a tree with read-only files and folders, like a git clone', () => {
    const root = sb.path('staging', 'clone')
    const pack = join(root, '.git', 'objects', 'pack')
    mkdirSync(pack, { recursive: true })
    writeFileSync(join(pack, 'pack-1.pack'), 'x')
    writeFileSync(join(pack, 'pack-1.idx'), 'x')
    chmodSync(join(pack, 'pack-1.pack'), 0o444)
    chmodSync(join(pack, 'pack-1.idx'), 0o444)
    // A read-only folder blocks deleting what's inside on macOS and Linux too.
    chmodSync(pack, 0o555)
    removeDir(root)
    expect(existsSync(root)).toBe(false)
  })

  it('a missing folder is fine', () => {
    expect(() => removeDir(sb.path('nope'))).not.toThrow()
  })
})
