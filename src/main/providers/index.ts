import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { ProviderProfile } from '@shared/types'
import { ClaudeProvider } from './claude'
import { errorStatus, isApiError } from './errors'
import { OpenAICompatibleProvider } from './openai-compatible'
import type { LLMProvider } from './types'

export function createProvider(profile: ProviderProfile, apiKey: string | undefined): LLMProvider {
  switch (profile.kind) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(profile, apiKey)
    case 'claude':
      return new ClaudeProvider(profile, apiKey)
  }
}

/** Turns SDK/network errors into a message a non-developer can act on. */
export function describeError(err: unknown): string {
  const e = { status: errorStatus(err), message: (err as { message?: string }).message }
  // Gateways like OpenRouter put the real reason (e.g. "rate-limited upstream") in the error body.
  const detail = serverDetail(err)
  const withDetail = (msg: string) => (detail ? `${msg}\n伺服器說明：${detail}` : msg)
  if (e.status === 400) return withDetail('請求被拒絕，可能是模型名稱或參數不正確（HTTP 400）')
  if (e.status === 401) return withDetail('API Key 無效或已過期（HTTP 401）')
  if (e.status === 402) return withDetail('額度不足（HTTP 402），請儲值或改用免費模型')
  if (e.status === 403) return withDetail('沒有權限使用這個模型（HTTP 403）')
  if (e.status === 404) return withDetail('找不到端點或模型，請檢查 Base URL 與模型名稱（HTTP 404）')
  if (e.status === 429) return withDetail('模型目前太忙或已達使用上限（HTTP 429），請稍後再試或換一個模型')
  if (e.status && e.status >= 500) return withDetail('伺服器錯誤（HTTP ' + e.status + '），請稍後再試')

  // The SDK wraps network failures as APIConnectionError -> fetch TypeError -> system error with a code.
  const code = errorCode(err)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '找不到主機，請檢查 Base URL 或網路 / VPN'
  if (code?.includes('CERT')) {
    return 'HTTPS 憑證無法驗證（' + code + '），公司內部 gateway 可能需要安裝公司根憑證'
  }
  if (err instanceof OpenAI.APIConnectionError || err instanceof Anthropic.APIConnectionError) {
    return '無法連線到伺服器，請確認 Base URL 正確、服務已啟動，以及網路 / VPN 已連線'
  }
  return e.message ?? String(err)
}

function serverDetail(err: unknown): string | undefined {
  if (!isApiError(err)) return undefined
  const body = err.error as { message?: unknown; metadata?: { raw?: unknown } } | undefined
  const raw = body?.metadata?.raw
  const text = typeof raw === 'string' ? raw : typeof body?.message === 'string' ? body.message : undefined
  // Upstream "raw" fields can be whole JSON payloads; keep the bubble readable.
  return text && text.length > 200 ? text.slice(0, 200) + '…' : text
}

function errorCode(err: unknown): string | undefined {
  let cur = err as { code?: unknown; cause?: unknown } | undefined
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur.code === 'string') return cur.code
    cur = cur.cause as typeof cur
  }
  return undefined
}
