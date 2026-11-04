import type { DshEvent } from './conversation.js'
import type { ModelSelection } from './dsh-client.js'
import { wireRecord } from './dsh-streams.js'

export type ServiceHealth = 'unverified' | 'verified' | 'auth' | 'subscription' | 'quota' | 'rate-limit' | 'network' | 'error'

/** Classify locally; never forward raw server errors (which may contain credentials) to diagnostics. */
export function classifyServiceError(error: unknown): ServiceHealth {
  const value = wireRecord(error) ? error : {}
  const detail = [value.code, value.message, value.status, value.statusCode].filter(v => typeof v === 'string' || typeof v === 'number').join(' ').toLowerCase()
  if (/quota|insufficient.credit|insufficient.balance|credit.balance|额度|余额/.test(detail)) return 'quota'
  if (/subscription|subscribe|billing|payment.required|\b402\b|订阅/.test(detail)) return 'subscription'
  if (/unauthoriz|invalid.{0,20}(key|token)|authentication|missing.credential|invalid.credential|no.credential|no.api.key|api.key.{0,20}(missing|invalid)|\b401\b/.test(detail)) return 'auth'
  if (/rate.limit|too.many.requests|\b429\b/.test(detail)) return 'rate-limit'
  if (/network|fetch.failed|timeout|timed.out|econn|enotfound|socket|dns|proxy|tls/.test(detail)) return 'network'
  return 'error'
}

/** Observe only live events, scoped to the actual request route, never restored history. */
export class ConnectionHealth {
  private readonly results = new Map<string, ServiceHealth>()
  private readonly requests = new Map<string, ModelSelection>()
  reset(): void { this.results.clear(); this.requests.clear() }
  status(selection: ModelSelection): ServiceHealth { return this.results.get(JSON.stringify([selection.provider, selection.model])) ?? 'unverified' }
  accept(sessionId: string, event: DshEvent, selection: ModelSelection): void {
    const data = wireRecord(event.data) ? event.data : {}
    if (event.type === 'user/message' && !this.requests.has(sessionId)) this.requests.set(sessionId, selection)
    if (event.type === 'request/header' && wireRecord(data.header) && wireRecord(data.header.config)) {
      const config = data.header.config
      if (typeof config.provider === 'string' && typeof config.model === 'string') this.requests.set(sessionId, { provider: config.provider, model: config.model })
    }
    const route = this.requests.get(sessionId)
    if (route === undefined) return
    const key = JSON.stringify([route.provider, route.model])
    if (event.type === 'assistant/message') this.results.set(key, 'verified')
    if (event.type === 'turn/end') {
      if (wireRecord(data.reason) && data.reason.kind === 'error') this.results.set(key, classifyServiceError(data.reason.error))
      this.requests.delete(sessionId)
    }
  }
}
