import type { ProviderProfile } from '@shared/types'

/** Provider-neutral conversation format used by the agent core. */
export type UserContent = { type: 'text'; text: string } | { type: 'image'; dataUrl: string }

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string exactly as the model produced it. */
  arguments: string
}

export type LLMMessage =
  | { role: 'system'; text: string }
  | { role: 'user'; content: UserContent[] }
  | { role: 'assistant'; text: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; text: string }

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
}

export interface LLMRequest {
  messages: LLMMessage[]
  tools?: ToolSpec[]
  signal?: AbortSignal
}

export type StreamEvent =
  | { type: 'text'; text: string }
  /** Which model is answering; reported once, as soon as the server says. */
  | { type: 'model'; model: string }
  /** Complete tool calls, emitted once after the stream finishes. */
  | { type: 'tool-calls'; calls: ToolCall[] }

export interface LLMProvider {
  readonly profile: ProviderProfile
  stream(req: LLMRequest): AsyncIterable<StreamEvent>
  listModels(): Promise<string[]>
}
