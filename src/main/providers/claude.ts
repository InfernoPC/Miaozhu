import Anthropic from '@anthropic-ai/sdk'
import type { ProviderProfile } from '@shared/types'
import { MAX_FALLBACK_MODELS } from '@shared/types'
import { errorStatus } from './errors'
import type { LLMMessage, LLMProvider, LLMRequest, StreamEvent, ToolCall } from './types'

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'
const MAX_TOKENS = 64_000
/** Server-side fallback picks a substitute by refusal category (beta). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

type MessageParam = Anthropic.Beta.BetaMessageParam
type ContentParam = Anthropic.Beta.BetaContentBlockParam

/** "data:image/jpeg;base64,…" → an image block. */
function imageBlock(dataUrl: string): ContentParam | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/)
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/png', data: m[2] } } : null
}

function parseInput(args: string): Record<string, unknown> {
  try {
    const v = args.trim() ? JSON.parse(args) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/**
 * Converts the neutral transcript to Messages API form. Assistant turns this same model
 * produced are replayed from their raw content (thinking blocks unchanged, as the API
 * requires inside a tool loop); turns from other providers are rebuilt from text + tool calls.
 * Consecutive tool results go into one user message, results first.
 */
export function toClaudeMessages(messages: LLMMessage[], model: string): { system: string; messages: MessageParam[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => (m as { text: string }).text).join('\n\n')
  const out: MessageParam[] = []
  const pushUser = (blocks: ContentParam[]) => {
    const last = out[out.length - 1]
    if (last?.role === 'user' && Array.isArray(last.content)) (last.content as ContentParam[]).push(...blocks)
    else out.push({ role: 'user', content: blocks })
  }

  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      pushUser(m.content.map((c) => (c.type === 'text' ? { type: 'text' as const, text: c.text } : imageBlock(c.dataUrl) ?? { type: 'text' as const, text: '[無法讀取的圖片]' })))
    } else if (m.role === 'assistant') {
      if (m.providerData?.kind === 'claude' && m.providerData.model === model) {
        out.push({ role: 'assistant', content: m.providerData.content as ContentParam[] })
        continue
      }
      const blocks: ContentParam[] = []
      if (m.text) blocks.push({ type: 'text', text: m.text })
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: parseInput(c.arguments) })
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] })
    } else {
      pushUser([{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.text, is_error: m.text.startsWith('錯誤：') || undefined }])
    }
  }
  return { system, messages: out }
}

/** Errors where another model may succeed: busy, overloaded, unavailable. */
function shouldTryNext(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return false
  const status = errorStatus(err)
  return status === 429 || status === 404 || status === 529 || (!!status && status >= 500)
}

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic

  constructor(
    readonly profile: ProviderProfile,
    apiKey: string | undefined
  ) {
    this.client = new Anthropic({ apiKey: apiKey ?? '', baseURL: profile.baseURL || undefined, maxRetries: 1 })
  }

  async *stream({ messages, tools, signal }: LLMRequest): AsyncIterable<StreamEvent> {
    const candidates = [this.profile.model || DEFAULT_CLAUDE_MODEL, ...(this.profile.fallbackModels ?? []).slice(0, MAX_FALLBACK_MODELS)]
    for (const [i, model] of candidates.entries()) {
      const isLast = i === candidates.length - 1
      let started = false
      try {
        const { system, messages: wire } = toClaudeMessages(messages, model)
        const stream = this.client.beta.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            // Set explicitly: some models default lower (Claude Opus 5.5 defaults to medium).
            output_config: { effort: 'medium' },
            // The system prompt and tool list are stable, so they cache across steps and turns.
            cache_control: { type: 'ephemeral' },
            system,
            messages: wire,
            tools: tools?.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
              // Large inputs (file contents) stream as generated; we validate them in parseArgs.
              eager_input_streaming: true
            }))
          },
          { signal, maxRetries: isLast ? 1 : 0 }
        )
        let reported = false
        for await (const event of stream) {
          if (event.type === 'message_start' && !reported) {
            reported = true
            yield { type: 'model', model: event.message.model }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            started = true
            yield { type: 'text', text: event.delta.text }
          } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            started = true
          }
        }
        const final = await stream.finalMessage()
        // Check why it stopped before acting on any tool call.
        if (final.stop_reason === 'refusal') {
          const why = final.stop_details?.explanation
          throw new RefusalError(`Claude 拒絕了這個請求${why ? `：${why}` : ''}`)
        }
        const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
        if (final.stop_reason === 'max_tokens' && toolUses.length) throw new Error('回覆太長被截斷，工具參數不完整，請把工作拆小一點再試')
        const calls: ToolCall[] = toolUses.map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) }))
        if (calls.length) yield { type: 'tool-calls', calls }
        yield { type: 'provider-data', data: { kind: 'claude', model, content: final.content as unknown[] } }
        return
      } catch (err) {
        if (err instanceof RefusalError || started || isLast || signal?.aborted || !shouldTryNext(err)) throw err
      }
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.client.models.list()) ids.push(m.id)
    return ids
  }
}

/** A safety decline that survived the server-side fallback; not worth retrying elsewhere. */
export class RefusalError extends Error {}
