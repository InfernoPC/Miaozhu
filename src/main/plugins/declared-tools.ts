import spawn from 'cross-spawn'
import { app } from 'electron'
import { ToolError, type ToolDef } from '../tools/types'
import type { DeclaredToolSpec } from './manifest'

const DEFAULT_TIMEOUT_S = 30
const MAX_TIMEOUT_S = 300
const MAX_OUTPUT = 20_000

type Secrets = (name: string) => string | undefined

/** `{param}` → the argument value; `${secret:name}` → the stored secret. */
function fill(template: string, input: Record<string, unknown>, secret: Secrets, encode = (s: string) => s): string {
  return template
    .replace(/\$\{secret:([a-zA-Z0-9_-]+)\}/g, (_m, name: string) => {
      const v = secret(name)
      if (v === undefined) throw new ToolError(`這個工具需要密鑰「${name}」，請使用者到「設定 → 外掛」填入`)
      return v
    })
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
      const v = input[key]
      return v === undefined || v === null ? '' : encode(typeof v === 'string' ? v : JSON.stringify(v))
    })
}

/** Body templates keep types: a string that is exactly "{param}" becomes the raw value. */
function fillDeep(value: unknown, input: Record<string, unknown>, secret: Secrets): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\{([a-zA-Z0-9_]+)\}$/)
    return whole ? input[whole[1]] : fill(value, input, secret)
  }
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, input, secret))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDeep(v, input, secret)]))
  return value
}

/** Never let a secret value reach the model or the UI, even inside an echoed URL or error. */
function redact(text: string, secretValues: string[]): string {
  return secretValues.filter((s) => s.length >= 4).reduce((t, s) => t.split(s).join('••••'), text)
}

const truncate = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '\n…（輸出過長，已截斷）' : s)

/** A placeholder-visible preview for the confirmation dialog (secrets stay hidden). */
function previewTemplate(template: string, input: Record<string, unknown>): string {
  return fill(template, input, () => '••••')
}

export function declaredTool(spec: DeclaredToolSpec, pluginName: string, secret: Secrets, secretValues: () => string[]): ToolDef {
  const timeout = Math.min(MAX_TIMEOUT_S, spec.timeoutSeconds ?? DEFAULT_TIMEOUT_S) * 1000

  const base = {
    spec: { name: spec.name, description: `${spec.description}（外掛「${pluginName}」提供）`, parameters: spec.inputSchema },
    risk: spec.risk,
    title: (i: Record<string, unknown>) => {
      const args = Object.values(i).filter((v) => typeof v === 'string' || typeof v === 'number').join('、')
      return `${spec.name}${args ? `：${String(args).slice(0, 80)}` : ''}`
    }
  }

  if (spec.kind === 'http') {
    const req = spec.request!
    return {
      ...base,
      detail: (i) => `${req.method} ${previewTemplate(req.url, i)}\n（外掛「${pluginName}」提供的工具）`,
      async run(i, ctx) {
        const url = fill(req.url, i, secret, encodeURIComponent)
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, fill(v, i, secret)]))
        let body: string | undefined
        if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
          const filled = fillDeep(req.body, i, secret)
          body = typeof filled === 'string' ? filled : JSON.stringify(filled)
          if (typeof filled !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'
        }
        const secrets = secretValues()
        const res = await fetch(url, { method: req.method, headers, body, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeout)]) }).catch((e) => {
          throw new ToolError(redact(`無法連線：${(e as Error).message}`, secrets))
        })
        const raw = await res.text()
        let text = raw
        try {
          text = JSON.stringify(JSON.parse(raw), null, 2)
        } catch {
          // not JSON; keep as text
        }
        if (!res.ok) throw new ToolError(redact(`HTTP ${res.status}：${text.slice(0, 500)}`, secrets))
        return { text: redact(truncate(text), secrets), summary: `HTTP ${res.status}` }
      }
    }
  }

  const argv = spec.command!
  return {
    ...base,
    detail: (i) => `$ ${argv.map((a) => previewTemplate(a, i)).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n（外掛「${pluginName}」提供的工具）`,
    async run(i, ctx) {
      // Each argv element is filled separately and passed without a shell,
      // so an argument like "; rm -rf ~" stays a literal string.
      const [bin, ...args] = argv.map((a) => fill(a, i, secret))
      const secrets = secretValues()
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd: app.getPath('home'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        const collect = (b: Buffer) => {
          if (out.length < MAX_OUTPUT * 2) out += b.toString('utf8')
        }
        child.stdout?.on('data', collect)
        child.stderr?.on('data', collect)
        let reason: string | null = null
        const timer = setTimeout(() => {
          reason = `超過 ${timeout / 1000} 秒，已強制停止`
          child.kill('SIGKILL')
        }, timeout)
        const onAbort = () => {
          reason = '已取消'
          child.kill('SIGKILL')
        }
        ctx.signal.addEventListener('abort', onAbort, { once: true })
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(new ToolError(redact(`無法執行 ${bin}：${e.message}`, secrets)))
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          ctx.signal.removeEventListener('abort', onAbort)
          const status = reason ?? `結束代碼 ${code}`
          resolve({ text: redact(`${status}\n${truncate(out.trimEnd()) || '（沒有輸出）'}`, secrets), summary: reason ?? (code === 0 ? '完成' : `結束代碼 ${code}`) })
        })
      })
    }
  }
}
