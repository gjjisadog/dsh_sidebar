import { describe, expect, it } from 'vitest'
import { normalizeDeepSeekApiKey, normalizeOpenCodeApiKey } from '../src/credentials.ts'

describe('DeepSeek API key input', () => {
  it('accepts a pasted key value and trims surrounding whitespace', () => {
    expect(normalizeDeepSeekApiKey('  sk-test-123  ')).toBe('sk-test-123')
  })

  it('rejects an empty value', () => {
    expect(() => normalizeDeepSeekApiKey('   ')).toThrow('Paste or enter')
  })

  it('rejects a pasted environment assignment', () => {
    expect(() => normalizeDeepSeekApiKey('DEEPSEEK_API_KEY=sk-test')).toThrow('only the API key value')
  })

  it('rejects surrounding quotes and non-printable characters', () => {
    expect(() => normalizeDeepSeekApiKey('"sk-test"')).toThrow('without surrounding quotes')
    expect(() => normalizeDeepSeekApiKey('sk-test\nsecond-line')).toThrow('printable ASCII')
  })
})

describe('OpenCode API key input', () => {
  it('normalizes the value and rejects assignments, quotes and control characters', () => {
    expect(normalizeOpenCodeApiKey('  sk-opencode-test  ')).toBe('sk-opencode-test')
    expect(() => normalizeOpenCodeApiKey('')).toThrow('OpenCode API key')
    expect(() => normalizeOpenCodeApiKey('OPENCODE_API_KEY=sk-test')).toThrow('only the API key value')
    expect(() => normalizeOpenCodeApiKey('"sk-test"')).toThrow('without surrounding quotes')
    expect(() => normalizeOpenCodeApiKey('sk-test\nsecret')).toThrow('printable ASCII')
  })
})
