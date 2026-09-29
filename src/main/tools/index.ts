import { fsTools } from './fs'
import { mapsDirections, mapsSearchPlaces } from './maps'
import { screenshot } from './screen'
import { runCommand } from './shell'
import { ToolError, type ToolDef } from './types'
import { webFetch, webSearch } from './web'

export const TOOLS: ToolDef[] = [...fsTools, runCommand, webSearch, webFetch, mapsSearchPlaces, mapsDirections, screenshot]

const byName = new Map(TOOLS.map((t) => [t.spec.name, t]))

export const findTool = (name: string) => byName.get(name)

interface Schema {
  properties?: Record<string, { type?: string; enum?: unknown[] }>
  required?: string[]
}

/**
 * Parses and checks model-produced arguments against the tool's schema. Small models often
 * send numbers as strings or leave out fields, so coerce what's safe and report the rest
 * back to the model as a fixable error instead of running with bad input.
 */
export function parseArgs(tool: ToolDef, raw: string): Record<string, unknown> {
  let args: unknown
  try {
    args = raw.trim() ? JSON.parse(raw) : {}
  } catch {
    throw new ToolError(`參數不是有效的 JSON：${raw.slice(0, 200)}`)
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolError('參數必須是 JSON 物件')
  const obj = args as Record<string, unknown>
  const schema = tool.spec.parameters as Schema

  for (const key of schema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === '') throw new ToolError(`缺少必要參數：${key}`)
  }
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    if (prop.type === 'integer' || prop.type === 'number') {
      const n = Number(v)
      if (!Number.isFinite(n)) throw new ToolError(`參數 ${key} 必須是數字`)
      obj[key] = n
    } else if (prop.type === 'boolean' && typeof v !== 'boolean') {
      obj[key] = v === 'true' || v === 1
    } else if (prop.type === 'string' && typeof v !== 'string') {
      obj[key] = String(v)
    }
    if (prop.enum && !prop.enum.includes(obj[key])) throw new ToolError(`參數 ${key} 只能是 ${prop.enum.join(' / ')}`)
  }
  return obj
}

export { ToolError }
export type { ToolDef }
