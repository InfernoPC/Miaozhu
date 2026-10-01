import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One scripted reply in Messages API streaming form. */
export interface ClaudeStep {
  status?: number
  thinking?: string
  text?: string
  tools?: { name: string; args: object }[]
  stop?: 'end_turn' | 'tool_use' | 'refusal' | 'max_tokens'
  explanation?: string
  /** The model reported in message_start (e.g. a server-side fallback). */
  servedBy?: string
}

/** A fake Anthropic Messages endpoint that streams SSE events like the real one. */
export class MockClaude {
  script: ClaudeStep[] = []
  requests: { body: any; headers: Record<string, unknown> }[] = []
  private server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      this.requests.push({ body, headers: req.headers })
      const step = this.script.shift() ?? { text: '完成' }
      if (step.status) {
        res.writeHead(step.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }))
        return
      }
      const send = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      send('message_start', {
        message: { id: `msg_${this.requests.length}`, type: 'message', role: 'assistant', content: [], model: step.servedBy ?? body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } }
      })
      let i = 0
      if (step.thinking !== undefined) {
        send('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } })
        send('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: step.thinking } })
        send('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: `sig-${this.requests.length}` } })
        send('content_block_stop', { index: i++ })
      }
      if (step.text) {
        send('content_block_start', { index: i, content_block: { type: 'text', text: '' } })
        for (const piece of step.text.match(/.{1,4}/gs) ?? []) send('content_block_delta', { index: i, delta: { type: 'text_delta', text: piece } })
        send('content_block_stop', { index: i++ })
      }
      for (const [n, t] of (step.tools ?? []).entries()) {
        send('content_block_start', { index: i, content_block: { type: 'tool_use', id: `toolu_${this.requests.length}_${n}`, name: t.name, input: {} } })
        const json = JSON.stringify(t.args)
        for (let k = 0; k < json.length; k += 6) send('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: json.slice(k, k + 6) } })
        send('content_block_stop', { index: i++ })
      }
      const stop = step.stop ?? (step.tools?.length ? 'tool_use' : 'end_turn')
      send('message_delta', {
        delta: { stop_reason: stop, stop_sequence: null, stop_details: stop === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: step.explanation ?? null } : null },
        usage: { output_tokens: 5 }
      })
      send('message_stop', {})
      res.end()
    })
  })

  async start(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()))
  }

  reset(script: ClaudeStep[]): void {
    this.script = script
    this.requests = []
  }
}
