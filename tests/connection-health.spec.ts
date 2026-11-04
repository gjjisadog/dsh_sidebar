import { describe, expect, it } from 'vitest'
import { ConnectionHealth, classifyServiceError } from '../src/connection-health.js'
import type { DshEvent } from '../src/conversation.js'
const model = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }
const event = (type: string, data: unknown = {}): DshEvent => ({ type, data, seq: 1, time: 1 } as DshEvent)
describe('service verification', () => {
  it.each([
    [{ code: 'MISSING_CREDENTIAL' }, 'auth'], [{ message: '401 Unauthorized' }, 'auth'],
    [{ message: '402 payment required' }, 'subscription'], [{ message: 'insufficient_quota' }, 'quota'],
    [{ message: '429 Too many requests' }, 'rate-limit'], [{ message: 'fetch failed: ECONNRESET' }, 'network'],
    [{ message: 'unknown failure sk-fake-secret' }, 'error'],
  ])('classifies %o as %s without exposing the error body', (error, status) => {
    expect(classifyServiceError(error)).toBe(status)
  })
  it('requires a live request and response; a restarted runtime needs verification again', () => {
    const health = new ConnectionHealth()
    health.accept('s', event('assistant/message'), model)
    expect(health.status(model)).toBe('unverified')
    health.accept('s', event('user/message'), model)
    health.accept('s', event('assistant/message'), model)
    expect(health.status(model)).toBe('verified')
    health.reset(); expect(health.status(model)).toBe('unverified')
  })
  it('attributes the result to the request route even if the user changes the selected model', () => {
    const health = new ConnectionHealth(), other = { provider: 'deepseek-official', model: 'deepseek-flash' }
    health.accept('s', event('request/header', { header: { config: model } }), model)
    health.accept('s', event('user/message'), other)
    health.accept('s', event('assistant/message'), other)
    expect(health.status(model)).toBe('verified'); expect(health.status(other)).toBe('unverified')
    health.accept('s', event('turn/end', { reason: { kind: 'error', error: { message: '401 Unauthorized' } } }), other)
    expect(health.status(model)).toBe('auth')
  })
  it('does not verify empty completed or aborted turns and scopes requests by session', () => {
    const health = new ConnectionHealth()
    health.accept('s', event('user/message'), model)
    health.accept('s', event('turn/end', { reason: { kind: 'aborted' } }), model)
    health.accept('other', event('assistant/message'), model)
    expect(health.status(model)).toBe('unverified')
  })
})
