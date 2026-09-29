import OpenAI from 'openai'

/**
 * The HTTP-like status of a provider error. Gateways such as OpenRouter sometimes answer
 * 200 and report the failure inside the stream, with the code in the body or only in the
 * message ("Service temporarily overloaded"); those still need to count as busy/rate-limited
 * so fallback and error messages treat them like the HTTP versions.
 */
export function errorStatus(err: unknown): number | undefined {
  if (!(err instanceof OpenAI.APIError)) return undefined
  if (typeof err.status === 'number') return err.status
  const code = (err.error as { code?: unknown } | undefined)?.code
  if (typeof code === 'number' && code >= 400) return code
  if (typeof code === 'string' && /^[45]\d\d$/.test(code)) return Number(code)
  const msg = err.message
  if (/rate.?limit|too many requests/i.test(msg)) return 429
  if (/overload|temporarily unavailable|service unavailable|upstream error/i.test(msg)) return 503
  return undefined
}
