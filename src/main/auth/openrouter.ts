import { shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const AUTH_URL = 'https://openrouter.ai/auth'
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'
const TIMEOUT_MS = 5 * 60_000

const base64url = (buf: Buffer) => buf.toString('base64url')

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:-apple-system,'Segoe UI','PingFang TC','Microsoft JhengHei',sans-serif;text-align:center;padding:64px 16px">
<div style="font-size:48px">🐱</div><h2>${title}</h2><p>${body}</p></body>`

let pending: { cancel: () => void } | null = null

export function cancelOpenRouterConnect(): void {
  pending?.cancel()
}

/**
 * OpenRouter OAuth PKCE for desktop apps: opens the browser, receives the code on a
 * one-shot loopback server, and exchanges it for a user-controlled API key.
 * https://openrouter.ai/docs/guides/overview/auth/oauth
 */
export async function connectOpenRouter(): Promise<string> {
  cancelOpenRouterConnect()

  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())

  // Listen on both loopback stacks: browsers may resolve "localhost" to 127.0.0.1 or ::1.
  const servers: Server[] = []
  const code = await new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null, value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pending = null
      // Give the browser a moment to receive the response page before closing.
      setTimeout(() => servers.forEach((s) => s.close()), 500)
      if (err) reject(err)
      else resolve(value!)
    }
    const timer = setTimeout(() => finish(new Error('等待 OpenRouter 授權逾時（5 分鐘），請再試一次')), TIMEOUT_MS)
    pending = { cancel: () => finish(new Error('已取消 OpenRouter 登入')) }

    const handler: Parameters<typeof createServer>[1] = (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const received = url.searchParams.get('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (received) {
        res.end(page('授權完成', '已連接 OpenRouter，可以關閉這個分頁回到喵助了。'))
        finish(null, received)
      } else {
        res.end(page('授權未完成', '沒有收到授權碼，請回到喵助重新登入。'))
        finish(new Error('OpenRouter 沒有回傳授權碼（可能按了取消）'))
      }
    }

    const v4 = createServer(handler)
    servers.push(v4)
    v4.on('error', (err) => finish(err))
    v4.listen(0, '127.0.0.1', () => {
      const { port } = v4.address() as AddressInfo
      const v6 = createServer(handler)
      servers.push(v6)
      v6.on('error', () => {}) // IPv6 may be disabled; 127.0.0.1 is enough then.
      v6.listen(port, '::1')

      const auth = new URL(AUTH_URL)
      auth.searchParams.set('callback_url', `http://localhost:${port}/callback`)
      auth.searchParams.set('code_challenge', challenge)
      auth.searchParams.set('code_challenge_method', 'S256')
      auth.searchParams.set('key_label', 'Desktop Agent')
      void shell.openExternal(auth.toString())
    })
  })

  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
  })
  if (!res.ok) throw new Error(`OpenRouter 交換 API Key 失敗（HTTP ${res.status}）`)
  const { key } = (await res.json()) as { key?: string }
  if (!key) throw new Error('OpenRouter 沒有回傳 API Key')
  return key
}
