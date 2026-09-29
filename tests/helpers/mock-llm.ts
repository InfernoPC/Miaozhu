import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One scripted reply from the fake model. */
export type Step =
  | { tool: string; args: object }
  | { text: string }
  | { status: number; message: string }

/**
 * A fake OpenAI-compatible server. Each request consumes the next scripted step and is
 * recorded, so tests can assert both what the agent did and what it sent to the model.
 * Tool-call arguments are streamed in small fragments, like real servers do.
 */
export class MockLLM {
  script: Step[] = []
  requests: any[] = []
  private server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      this.requests.push(parsed)
      const step = this.script.shift() ?? { text: '完成' }
      if ('status' in step) {
        res.writeHead(step.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: step.message } }))
        return
      }
      const send = (delta: object) =>
        res.write(
          `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: parsed.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
        )
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if ('tool' in step) {
        const args = JSON.stringify(step.args)
        send({ tool_calls: [{ index: 0, id: `call_${this.requests.length}`, type: 'function', function: { name: step.tool, arguments: '' } }] })
        for (let i = 0; i < args.length; i += 7) send({ tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 7) } }] })
      } else {
        send({ content: step.text })
      }
      res.end('data: [DONE]\n\n')
    })
  })

  async start(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()))
  }

  reset(script: Step[]): void {
    this.script = script
    this.requests = []
  }

  /** Content of the latest tool-result message in request #i. */
  toolResult(i: number): string {
    return this.requests[i]?.messages.filter((m: any) => m.role === 'tool').pop()?.content ?? ''
  }

  /** Every byte sent to the model so far — for "never leaked" assertions. */
  get sentText(): string {
    return JSON.stringify(this.requests)
  }
}
