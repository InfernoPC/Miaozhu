import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPlugin } from '../src/main/plugins/manifest'

describe('bundled example plugin', () => {
  it('reads cleanly, so people copying it start from something valid', () => {
    const p = readPlugin(resolve(__dirname, '../plugins/examples/team-toolkit'))
    expect(p.warnings).toEqual([])
    expect(p.skills.map((s) => s.name)).toEqual(['會議記錄'])
    expect(p.tools.map((t) => t.name)).toEqual(['exchange_rates'])
  })
})
