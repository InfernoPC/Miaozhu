import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeError } from '../src/main/providers'
import { OpenAICompatibleProvider } from '../src/main/providers/openai-compatible'
import type { StreamEvent } from '../src/main/providers/types'
import { MockLLM } from './helpers/mock-llm'

let llm: MockLLM
let baseURL: string
beforeAll(async () => {
  llm = new MockLLM()
  baseURL = await llm.start()
})
afterAll(() => llm.stop())

async function collect(model: string, fallbackModels: string[]) {
  const p = new OpenAICompatibleProvider({ id: 'p', name: 'm', kind: 'openai-compatible', baseURL, model, fallbackModels }, 'k')
  const events: StreamEvent[] = []
  let error: unknown
  try {
    for await (const e of p.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) events.push(e)
  } catch (err) {
    error = err
  }
  return { events, error, tried: llm.requests.map((r) => r.model) }
}

describe('fallback models', () => {
  it('moves to the next model when the first is rate-limited', async () => {
    llm.reset([{ status: 429, message: 'busy upstream' }, { text: 'hello' }])
    const r = await collect('busy', ['good'])
    expect(r.tried).toEqual(['busy', 'good'])
    expect(r.events).toContainEqual({ type: 'model', model: 'good' })
    expect(r.events).toContainEqual({ type: 'text', text: 'hello' })
  })

  it('skips over a gated model too', async () => {
    llm.reset([{ status: 429, message: 'busy' }, { status: 403, message: 'gated' }, { text: 'hi' }])
    expect((await collect('a', ['b', 'c'])).tried).toEqual(['a', 'b', 'c'])
  })

  it('does not fall back on a bad request, which another model would reject too', async () => {
    llm.reset([{ status: 400, message: 'bad' }, { text: 'never' }])
    const r = await collect('a', ['b'])
    expect(r.tried).toEqual(['a'])
    expect(r.error).toBeInstanceOf(OpenAI.APIError)
  })

  it('falls back when the error arrives inside the stream (HTTP 200)', async () => {
    llm.reset([{ streamError: 'Upstream error from Nvidia: Service temporarily overloaded', code: 502 }, { text: 'ok' }])
    const r = await collect('a', ['b'])
    expect(r.tried).toEqual(['a', 'b'])
    expect(r.events).toContainEqual({ type: 'text', text: 'ok' })
  })

  it('falls back on an in-stream overload error even without a code', async () => {
    llm.reset([{ streamError: 'Service temporarily overloaded' }, { text: 'ok' }])
    expect((await collect('a', ['b'])).tried).toEqual(['a', 'b'])
  })

  it('reports the last error when every model is busy', async () => {
    llm.reset([
      { status: 429, message: 'busy' },
      { status: 429, message: 'busy' },
      { status: 429, message: 'busy' }
    ])
    const r = await collect('a', ['b'])
    expect((r.error as { status?: number }).status).toBe(429)
  })
})

describe('describeError', () => {
  const apiError = (status: number, body: object) => OpenAI.APIError.generate(status, { error: body }, undefined, new Headers())

  it('shows the gateway-provided reason alongside the summary', () => {
    const msg = describeError(apiError(429, { message: 'Provider returned error', metadata: { raw: 'x:free is temporarily rate-limited upstream' } }))
    expect(msg).toContain('HTTP 429')
    expect(msg).toContain('rate-limited upstream')
  })

  it('explains an in-stream overload in plain words, keeping the original reason', async () => {
    llm.reset([{ streamError: 'Upstream error from Nvidia: Service temporarily overloaded', code: 502 }])
    const r = await collect('only', [])
    const msg = describeError(r.error)
    expect(msg).toContain('稍後再試')
    expect(msg).toContain('overloaded')
  })

  it('explains an invalid key', () => {
    expect(describeError(apiError(401, { message: 'no' }))).toContain('API Key')
  })

  it('turns connection failures into actionable text', async () => {
    const p = new OpenAICompatibleProvider({ id: 'p', name: 'm', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:59999/v1', model: 'x' }, 'k')
    let err: unknown
    try {
      for await (const _ of p.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })) void _
    } catch (e) {
      err = e
    }
    expect(describeError(err)).toContain('無法連線')
  })
})
