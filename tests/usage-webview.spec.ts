import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { chatHtml } from '../src/webview.js'

function harness() {
  const html = chatHtml({ cspSource: 'test:' } as any, { toString: () => '' } as any,
    { script: { toString: () => '' }, style: { toString: () => '' }, scroll: { toString: () => '' } } as any, 'zh-cn')
  const dom = new JSDOM(html), document = dom.window.document
  const elements = Object.fromEntries(['usageFooter','usageLabel','usagePercent','usageTrack','usageControl','usageFill','usageStats','usageTrigger','usagePanel'].map(id => [id, document.getElementById(id)!]))
  const node = (tag: string, className = '', text = '') => {
    const element = document.createElement(tag); element.className = className; element.textContent = text; return element
  }
  const source = html.slice(html.indexOf('function formatTokens('), html.indexOf('function sameSelection('))
  const render = new Function('elements','node','t','document',`let usageOpen = true; ${source}; return renderUsage;`)(elements,node,(_en: string, zh: string) => zh,document)
  return { dom, elements, render }
}
const usage = { available:true, percent:20, usedTokens:40_000, contextWindow:200_000,
  tokenUsage:{uncachedInputTokens:100_000,cacheReadTokens:80_000,cacheWriteTokens:0,outputTokens:24_000} }
describe('clear usage display', () => {
  it('separates current context occupancy from cumulative session tokens', () => {
    const h=harness()
    try {
      h.render({usage})
      expect(h.elements.usageLabel.textContent).toBe('上下文')
      expect(h.elements.usagePercent.textContent).toBe('20%')
      expect(h.elements.usagePanel.querySelector('.usage-capacity')!.textContent).toBe('~40K / 200K tokens')
      expect(h.elements.usageStats.textContent).toBe('累计 204K tokens')
      expect(h.elements.usageTrack.getAttribute('aria-valuenow')).toBe('20')
      expect(h.elements.usageFill.getAttribute('stroke-dasharray')).toBe('20 100')
      expect(h.elements.usagePanel.textContent).toContain('剩余空间~160K')
      expect(h.elements.usagePanel.textContent).toContain('不等于上下文占用')
    } finally {h.dom.window.close()}
  })
  it('shows missing capacity explicitly while retaining cumulative usage', () => {
    const h=harness()
    try {
      h.render({usage:{...usage,available:false}})
      expect(h.elements.usagePercent.textContent).toBe('—')
      expect(h.elements.usagePanel.querySelector('.usage-capacity')!.textContent).toBe('未提供容量')
      expect(h.elements.usageTrack.hasAttribute('aria-valuenow')).toBe(false)
      expect(h.elements.usageTrack.classList.contains('hidden')).toBe(true)
      expect(h.elements.usageControl.classList.contains('hidden')).toBe(false)
      expect(h.elements.usageStats.textContent).toContain('204K')
      h.render({usage:{available:false}})
      expect(h.elements.usageControl.classList.contains('hidden')).toBe(true)
      expect(h.elements.usageStats.classList.contains('hidden')).toBe(true)
    } finally {h.dom.window.close()}
  })
  it('uses clear low-usage and high-pressure states with bounded percentages', () => {
    const h=harness()
    try {
      h.render({usage:{...usage,percent:0,usedTokens:200}})
      expect(h.elements.usagePercent.textContent).toBe('<1%')
      h.render({usage:{...usage,percent:80}})
      expect(h.elements.usageTrigger.classList.contains('warning')).toBe(true)
      h.render({usage:{...usage,percent:150,usedTokens:240_000}})
      expect(h.elements.usagePercent.textContent).toBe('100%')
      expect(h.elements.usageTrigger.classList.contains('danger')).toBe(true)
      expect(h.elements.usageTrigger.classList.contains('warning')).toBe(false)
      expect(h.elements.usagePanel.textContent).toContain('剩余空间~0')
    } finally {h.dom.window.close()}
  })
})
