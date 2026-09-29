import type { SearchConfig, ToolRisk } from '@shared/types'
import type { ToolSpec } from '../providers/types'

export interface ToolContext {
  signal: AbortSignal
  /** Search provider settings and key, read at call time so settings changes apply immediately. */
  search(): { config: SearchConfig; apiKey?: string }
  /** Walkers skip these so a folder search never reads e.g. ~/.ssh. */
  isBlocked(absPath: string): boolean
  /** Hides the pet (e.g. for screenshots); call the returned function to show it again. */
  hidePet(): Promise<() => void>
}

export interface ToolResult {
  /** What the model reads. */
  text: string
  /** What the user sees on the tool card. */
  summary: string
  /** data: URLs; sent to the model as a follow-up image message. */
  images?: string[]
}

export interface PathAccess {
  path: string
  access: 'read' | 'write'
}

export interface ToolDef<I = Record<string, unknown>> {
  spec: ToolSpec
  risk: ToolRisk
  /** One-line description for tool cards, e.g. 「讀取 ~/Documents/a.txt」. */
  title(input: I): string
  /** File system paths this call touches, for permission checks. */
  paths?(input: I): PathAccess[]
  /** Extra text for the confirmation dialog (command, content preview…). */
  detail?(input: I): Promise<string> | string
  /** For network tools: a reason to ask the user even though network calls are normally allowed. */
  askReason?(input: I): string | undefined
  run(input: I, ctx: ToolContext): Promise<ToolResult>
}

/** Errors thrown with this class are shown to the model as-is (no stack, no prefix). */
export class ToolError extends Error {}
