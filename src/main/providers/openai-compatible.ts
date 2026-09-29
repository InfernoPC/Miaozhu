import OpenAI from 'openai'
import { MAX_FALLBACK_MODELS, type ProviderProfile } from '@shared/types'
import { errorStatus } from './errors'
import type { LLMMessage, LLMProvider, LLMRequest, StreamEvent, ToolCall } from './types'

/**
 * Talks to any server that speaks the OpenAI Chat Completions API:
 * OpenAI, Azure OpenAI (v1 endpoint), LiteLLM / One API gateways, Ollama, LM Studio, vLLM.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private client: OpenAI

  constructor(
    readonly profile: ProviderProfile,
    apiKey: string | undefined
  ) {
    this.client = new OpenAI({
      baseURL: profile.baseURL,
      // Local servers ignore the key, but the SDK requires a non-empty value.
      apiKey: apiKey || 'not-needed',
      defaultHeaders: profile.headers,
      maxRetries: 1
    })
  }

  /**
   * Tries the main model, then each fallback, moving on only while nothing has been shown yet.
   * Done client-side because gateway-side fallback (e.g. OpenRouter `models`) does not cover
   * every "rate-limited upstream" case, and this way it works with any OpenAI-compatible server.
   */
  async *stream({ messages, tools, signal }: LLMRequest): AsyncIterable<StreamEvent> {
    const fallbacks = (this.profile.fallbackModels?.filter(Boolean) ?? []).slice(0, MAX_FALLBACK_MODELS)
    const candidates = [this.profile.model, ...fallbacks]
    const wireMessages = messages.map(toWire)
    const wireTools = tools?.length
      ? tools.map<OpenAI.ChatCompletionTool>((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }))
      : undefined

    for (const [i, model] of candidates.entries()) {
      const isLast = i === candidates.length - 1
      let started = false
      try {
        const stream = await this.client.chat.completions.create(
          { model, messages: wireMessages, tools: wireTools, stream: true },
          // With a fallback waiting, switching beats the SDK's backoff-and-retry on the same busy model.
          { signal, maxRetries: isLast ? 1 : 0 }
        )
        // Tool calls arrive as fragments keyed by index; name/id come first, arguments stream in.
        const calls = new Map<number, ToolCall>()
        for await (const chunk of stream) {
          if (!started && chunk.model) yield { type: 'model', model: chunk.model }
          const delta = chunk.choices[0]?.delta
          if (delta?.content) {
            started = true
            yield { type: 'text', text: delta.content }
          }
          for (const tc of delta?.tool_calls ?? []) {
            started = true
            const call = calls.get(tc.index) ?? { id: '', name: '', arguments: '' }
            if (tc.id) call.id = tc.id
            if (tc.function?.name) call.name += tc.function.name
            if (tc.function?.arguments) call.arguments += tc.function.arguments
            calls.set(tc.index, call)
          }
        }
        if (calls.size) {
          const list = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c)
          // Some servers omit ids; the protocol needs one to pair results with calls.
          list.forEach((c, n) => (c.id ||= `call_${Date.now()}_${n}`))
          yield { type: 'tool-calls', calls: list }
        }
        return
      } catch (err) {
        if (started || isLast || signal?.aborted || !shouldFallback(err)) throw err
      }
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = []
    for await (const model of this.client.models.list()) ids.push(model.id)
    return ids.sort()
  }
}

/** Errors where another model may well succeed: busy, down, gated, or out of credit for this model. */
function shouldFallback(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return false // the whole server is unreachable
  const status = errorStatus(err)
  return status === 402 || status === 403 || status === 404 || status === 408 || status === 429 || (!!status && status >= 500)
}

function toWire(m: LLMMessage): OpenAI.ChatCompletionMessageParam {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.text }
    case 'user':
      // Plain string when there is no image: some local servers reject content arrays.
      if (m.content.every((c) => c.type === 'text')) {
        return { role: 'user', content: m.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n\n') }
      }
      return {
        role: 'user',
        content: m.content.map<OpenAI.ChatCompletionContentPart>((c) =>
          c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image_url', image_url: { url: c.dataUrl } }
        )
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: m.text || null,
        tool_calls: m.toolCalls?.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: c.arguments || '{}' }
        }))
      }
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.text }
  }
}
