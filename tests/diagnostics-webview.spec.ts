import { describe, expect, it } from 'vitest'
import { chatHtml } from '../src/webview.js'

describe('chat without service settings', () => {
  it('omits the service status bar and its settings from the composer', () => {
    const html = chatHtml({ cspSource: 'test:' } as any, { toString: () => '' } as any,
      { script: { toString: () => '' }, style: { toString: () => '' }, scroll: { toString: () => '' } } as any, 'zh-cn')
    expect(html).not.toContain('id="diagnostics"')
    expect(html).not.toContain('renderDiagnostics')
    expect(html).not.toContain('diagnostic-action')
    expect(html).toContain('id="prompt"')
    expect(html).toContain('id="models"')
  })
})
