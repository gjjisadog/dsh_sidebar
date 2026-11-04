import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import type * as vscode from 'vscode'
import { chatHtml as createChatHtml } from '../src/webview.js'

function chatHtml(webview: vscode.Webview, mark: vscode.Uri): string {
  return createChatHtml(webview, mark, {
    script: { toString: () => 'vscode-resource:/dist/webview/markdown.js' } as vscode.Uri,
    style: { toString: () => 'vscode-resource:/dist/webview/katex.min.css' } as vscode.Uri,
    scroll: { toString: () => 'vscode-resource:/dist/webview/scroll.js' } as vscode.Uri,
  })
}

describe('chat webview', () => {
  it('renders compact context labels, hides the duplicate active file, and retains full paths and pinned removal', () => {
    const html = chatHtml({ cspSource: 'test:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    const dom = new JSDOM(html)
    try {
      const document = dom.window.document
      const contextChips = document.getElementById('contextChips')!
      const node = (tag: string, className: string, text = '') => {
        const element = document.createElement(tag); element.className = className; element.textContent = text; return element
      }
      const sent: unknown[] = []
      const source = html.slice(html.indexOf('function sameSelection('), html.indexOf('function currentMentionQuery('))
      const render = new Function('ideContext', 'elements', 'node', 'vscode', source + '; renderIdeContext();')
      const draw = (context: unknown) => render(context, { contextChips }, node, { postMessage: (message: unknown) => sent.push(message) })
      const path = 'project/hybrid30k/modules/cpu1/ctrl/ctrl.c'
      const activeFile = { kind: 'file', path }
      const selection = { kind: 'selection', path, startLine: 606, endLine: 623, truncated: true }
      draw({ activeFile, pinned: [] })
      expect(contextChips.querySelector('.context-name')!.textContent).toBe('ctrl.c')
      expect(contextChips.firstElementChild!.getAttribute('title')).toBe(path)
      draw({ activeFile, selection, pinned: [] })
      expect(contextChips.children).toHaveLength(1)
      expect(contextChips.querySelector('.context-name')!.textContent).toBe('ctrl.c:606–623')
      expect(contextChips.firstElementChild!.getAttribute('title')).toBe(path + ':606–623 (truncated)')
      draw({ activeFile, selection, pinned: [{ ...selection, id: 'pinned' }] })
      expect(contextChips.children).toHaveLength(1)
      ;(contextChips.querySelector('button') as HTMLButtonElement).click()
      expect(sent).toEqual([{ type: 'remove-context', id: 'pinned' }])
      draw({ activeFile, selection: { ...selection, path: 'other/ctrl.c', endLine: 606 }, pinned: [] })
      expect([...contextChips.querySelectorAll('.context-name')].map(item => item.textContent)).toEqual(['ctrl.c', 'ctrl.c:606'])
      expect([...contextChips.children].map(item => item.getAttribute('title'))).toEqual([path, 'other/ctrl.c:606 (truncated)'])
      draw({ activeFile: { kind: 'file', path: 'C:\\project\\ctrl.c' }, pinned: [] })
      expect(contextChips.querySelector('.context-name')!.textContent).toBe('ctrl.c')
      draw({ pinned: [] })
      expect(contextChips.classList.contains('hidden')).toBe(true)
    } finally { dom.window.close() }
  })

  it('keeps model selection enabled when the current model is unroutable, but blocks sending', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    const source = html.slice(html.indexOf('const sessionReady ='), html.indexOf('elements.cancel.classList.toggle'))
    const elements = { prompt: {}, attach: {}, project: {}, newSession: {}, sessionTrigger: {}, models: {}, efforts: { options: [], value: '' } } as any
    const render = new Function('current', 'elements', source)
    render({ phase: 'ready', sessionId: 's', routable: false, models: [{ model: 'available' }] }, elements)
    expect(elements.models.disabled).toBe(false)
    expect(elements.prompt.disabled).toBe(true)
    render({ phase: 'loading', sessionId: 's', routable: false, models: [{ model: 'available' }] }, elements)
    expect(elements.models.disabled).toBe(true)
  })

  it('does not silently select the first available model when the previous model disappeared', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    const source = html.slice(html.indexOf('function renderModelOptions('), html.indexOf('function renderAttachments('))
    const options: any[] = []
    const render = new Function('elements', 'Option', 'renderEfforts', `${source}; return renderModelOptions;`)(
      { models: { replaceChildren() { options.length = 0 }, append(value: unknown) { options.push(value) } } },
      function(this: any, label: string, value: string, _default: boolean, selected: boolean) { Object.assign(this, { label, value, selected }) },
      () => {},
    )
    render({ models: [{ provider: 'p', model: 'new', label: 'New', selected: false }] })
    expect(options[0]).toMatchObject({ label: 'Choose a model', value: '', selected: true, disabled: true })
    expect(options[1].selected).toBe(false)
  })

  it('does not invent a selected permission when the current policy is absent from the catalog', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    expect(html).toContain('const selectedPermission = permissions.find(permission => permission.selected);')
    expect(html).not.toContain('|| permissions[0]')
  })

  it('offers separate reconnect and explicit runtime restart actions', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    expect(html).toContain("t('Reconnect', '重新连接')); retry.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' }))")
    expect(html).toContain("t('Restart Runtime', '重启运行时')); restart.addEventListener('click', () => vscode.postMessage({ type: 'restart' }))")
    expect(html).toContain('if (current.canReconnect)')
  })

  it('loads bundled Markdown, math CSS and fonts without remote scripts or unsafe script execution', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark.svg' } as vscode.Uri)
    expect(html).toContain('src="vscode-resource:/dist/webview/markdown.js"')
    expect(html).toContain('href="vscode-resource:/dist/webview/katex.min.css"')
    expect(html).toContain('font-src vscode-webview:')
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]+';/)
    expect(html).not.toContain('unsafe-eval')
    expect(html).not.toContain('unsafe-inline')
    expect(html).toContain('dshMarkdown.renderMarkdown')
    expect(html).toContain('dshMarkdown.scanMarkdownStream')
  })
  it('emits valid browser JavaScript', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1]

    expect(script).toBeDefined()
    expect(() => new Function(script ?? '')).not.toThrow()
  })

  it('offers a compact GitHub star action in the conversation toolbar', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('aria-label="Star dsh-vscode on GitHub"')
    expect(html).toContain("href: 'https://github.com/Lixxx1/dsh-vscode'")
  })

  it('binds queue actions to the rendered conversation and blocks actions during loading', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    const start = html.indexOf('function postQueueAction(')
    const end = html.indexOf('function renderQueue(', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const sent: unknown[] = []
    const state = { phase: 'ready', sessionId: 'a' }
    const post = new Function('state', 'vscode', `${html.slice(start, end)}; return postQueueAction;`)(state, { postMessage: (value: unknown) => sent.push(value) })
    post('a', 'row', 'edit', 'Updated')
    expect(sent).toEqual([{ type: 'queue-action', sessionId: 'a', itemId: 'row', action: 'edit', text: 'Updated' }])
    state.phase = 'loading'
    post('a', 'row', 'remove')
    state.phase = 'ready'
    state.sessionId = 'b'
    post('a', 'row', 'steer')
    expect(sent).toHaveLength(1)
    expect(html).toContain("postQueueAction(sessionId, item.id, 'remove')")
    expect(html).toContain("postQueueAction(sessionId, item.id, 'steer')")
    expect(html).toContain("postQueueAction(sessionId, item.id, 'edit', text)")
    expect(html).toContain('queueEditing.sessionId !== sessionId')
  })

  it('uses a searchable session center with official rename and archive actions', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('placeholder="Search conversations"')
    expect(html).toContain("type: 'rename-session'")
    expect(html).toContain("type: 'archive-session'")
    expect(html).toContain('const sessionDrafts = new Map()')
    expect(html).toContain('const draftImagesBySession = new Map()')
    expect(html).toContain('const pendingDraftSends = new Map()')
    expect(html).toContain("event.data.type === 'restore-draft'")
    expect(html).not.toContain('<select id="sessions"')
  })

  it('renders a compact background-response badge and prioritizes pending requests over Running', () => {
    const html = chatHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    const source = html.slice(html.indexOf('function renderSessionCenter('), html.indexOf('function record('))
    const node = (_tag: string, className = '', textContent = ''): any => ({
      className, textContent, title: '', children: [] as any[], attributes: {} as Record<string, string>,
      classList: { toggle(name: string, value: boolean) { this[name as keyof typeof this] = value as never } },
      append(...items: any[]) { this.children.push(...items) }, replaceChildren() { this.children = [] },
      setAttribute(name: string, value: string) { this.attributes[name] = value }, addEventListener() {},
    })
    const badge = node('span')
    const elements = { sessionTrigger: node('button'), sessionTriggerTitle: node('span'), sessionList: node('div'), sessionSearch: { value: '' } }
    const render = new Function('elements', 'document', 'node', 'array', 'string', 'relativeSessionTime', 'sessionActionId',
      `${source}; return renderSessionCenter;`)(elements, { getElementById: () => badge }, node, (a: any) => a, (s: any) => s, () => 'Just now', undefined)
    const current = { sessionId: 'a', sessions: [
      { id: 'a', title: 'Current', blank: true },
      { id: 'b', title: 'Work', blank: true, running: true, attention: { approvals: 2, questions: 1 } },
      { id: 'c', title: 'Question', blank: true, attention: { approvals: 0, questions: 1 } },
    ] }
    render(current)
    expect(badge.textContent).toBe('2')
    expect(badge.classList.hidden).toBe(false)
    expect(elements.sessionTrigger.attributes['aria-label']).toContain('2 other conversation(s) need your response')
    expect(elements.sessionList.children[1].children[0].children[0].className).toBe('session-indicator attention')
    expect(elements.sessionList.children[1].children[0].children[2].textContent).toBe('Awaiting approval')
    expect(elements.sessionList.children[2].children[0].children[2].textContent).toBe('Awaiting your answer')
    render({ ...current, sessionId: 'b', sessions: [current.sessions[1]] })
    expect(badge.classList.hidden).toBe(true)
    expect(elements.sessionTriggerTitle.textContent).toBe('Work')
    render({ sessionId: 'a', sessions: [current.sessions[0]] })
    expect(elements.sessionTrigger.attributes['aria-label']).toBe('Project conversations')
  })

  it('attaches supported clipboard images without intercepting ordinary text paste', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain("elements.prompt.addEventListener('paste'")
    expect(script).toContain("if (!files.length) return;")
    expect(script).toContain("item.getAsFile()")
    expect(script).toContain("reader.readAsDataURL(file)")
    expect(script).toContain("type: 'attach-images', sessionId, requestId, images")
    const pasteHandler = script.slice(script.indexOf("elements.prompt.addEventListener('paste'"))
    expect(pasteHandler.indexOf("if (!files.length) return;")).toBeLessThan(pasteHandler.indexOf('event.preventDefault();'))
  })

  it('blocks sending until the extension acknowledges pasted attachments', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain('const pendingAttachmentRequests = new Map()')
    expect(script).toContain('pendingAttachmentRequests.set(requestId, { sessionId })')
    expect(script).toContain("request => request.sessionId === sessionId)) return;")
    expect(script).toContain("event.data.type === 'attachments-added'")
    expect(script).toContain('pendingAttachmentRequests.delete(event.data.requestId)')
  })

  it('offers actionable setup states instead of a generic reconnect loop', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)

    expect(html).toContain('Open a project to get started')
    expect(html).toContain("type: 'open-workspace'")
    expect(html).toContain('Install DeepSeek Harness')
    expect(html).toContain('https://github.com/deepseek-ai/deepseek-harness')
    expect(html).toContain("type: 'configure-api-key'")
    expect(html).toContain("setup === 'runtime-auth'")
    expect(html).toContain("vscode.postMessage({ type: 'connect-existing-runtime' })")
    expect(html).toContain("vscode.postMessage({ type: 'start-managed-runtime' })")
    expect(html).not.toContain('launchUrl')
  })

  it('uses append-only output and streaming paths', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''

    expect(script).toContain('controller.append(event.data.page.message')
    expect(script).not.toContain('renderedMessages.delete(event.data.messageId)')
    expect(script).not.toContain('value.startsWith(stream.text)')
    expect(script).not.toContain('rendered.node.replaceWith')
    expect(script).toContain("pendingMessageAppends.set(append.id")
    expect(script).toContain("target.textContent += continuation.textContent")
  })

  it('does not restore the raw exit marker when a terminal result has an empty output body', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''
    const start = script.indexOf('function renderToolBody(')
    const end = script.indexOf('\n    function ', start + 1)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const node = (_tag: string, _class?: string, text?: string) => ({ text, children: [] as unknown[], append(...values: unknown[]) { this.children.push(...values) } })
    const render = new Function('node', 'string', 'appendPre', 'appendImages', `${script.slice(start, end)}; return renderToolBody;`)(
      node, (value: unknown) => typeof value === 'string' ? value : '',
      (parent: ReturnType<typeof node>, text: string) => { if (text) parent.append(node('pre', '', text)) },
      () => {},
    )
    const body = render({ rawResult: '\n[exit code: 2]' }, { card: 'terminal' }, { card: 'terminal', output: '', exitCode: 2 })
    expect(body.children).toEqual([{ text: 'Exit 2', children: [], append: expect.any(Function) }])
  })

  it('keeps tools compact until explicitly expanded, preserves that choice, and opens failures without pinning them', async () => {
    const html = chatHtml({ cspSource: 'test:' } as vscode.Webview, { toString: () => 'mark' } as vscode.Uri)
    const dom = new JSDOM(html)
    try {
      const document = dom.window.document
      const expanded = new Set<string>()
      let bodies = 0
      let loads = 0
      const node = (tag: string, className = '', text = '') => {
        const element = document.createElement(tag); element.className = className; element.textContent = text; return element
      }
      const source = html.slice(html.indexOf('function renderTool(message)'), html.indexOf('function renderCommand(message)'))
      const render = new Function('document', 'node', 'record', 'string', 't', 'toolTitle', 'expandedToolIds', 'conversationScroller', 'renderToolBody', 'appendPre', 'attachDeferredOutput', source + '; return renderTool;')(
        document, node, (value: unknown) => value, (value: unknown) => typeof value === 'string' ? value : '', (english: string) => english,
        (_message: unknown, call: { title: string }) => call.title, expanded, { pause() {} }, () => { bodies++; return node('div', 'tool-body', 'output') },
        (parent: HTMLElement, text: string, className: string) => parent.append(node('pre', className, text)), () => { loads++ },
      )
      const running = { id: 'tool:one', text: 'bash', streaming: true, detail: 'Running…', callView: { card: 'terminal', title: 'cd /workspace && ls', description: 'List project files' } }
      const initial = render(running) as HTMLDetailsElement
      expect(initial.open).toBe(false)
      expect(bodies).toBe(0)
      expect(initial.querySelector('.tool-kind')!.textContent).toBe('Bash')
      expect(initial.querySelector('.tool-title')!.textContent).toBe('List project files')
      expect(initial.querySelector('.tool-title')!.getAttribute('title')).toBe('cd /workspace && ls')
      initial.querySelector('summary')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(initial.open).toBe(true)
      expect(bodies).toBe(1)
      const completed = { ...running, streaming: false, detail: 'Completed' }
      const next = render(completed) as HTMLDetailsElement
      expect(next.open).toBe(true)
      expect(next.querySelector('.tool-detail')).toBeNull()
      next.querySelector('summary')!.click()
      expect((render(completed) as HTMLDetailsElement).open).toBe(false)
      const deferred = render({ ...completed, deferredBody: true }) as HTMLDetailsElement
      expect(loads).toBe(0)
      deferred.querySelector('summary')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(loads).toBe(1)
      expect(deferred.querySelector('.tool-command')!.textContent).toBe('$ cd /workspace && ls')
      deferred.querySelector('summary')!.click()
      const failed = render({ ...completed, failed: true }) as HTMLDetailsElement
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(failed.open).toBe(true)
      expect(expanded.size).toBe(0)
      expect((render(completed) as HTMLDetailsElement).open).toBe(false)
    } finally { dom.window.close() }
  })

  it('detaches tail following before loading earlier history', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(chatHtml(webview, mark))?.[1] ?? ''
    const historyClick = script.indexOf("button.addEventListener('click'")
    const detachTail = script.indexOf('conversationScroller.preserveHistory()', historyClick)
    const requestHistory = script.indexOf("vscode.postMessage({ type: 'load-history' })", historyClick)

    expect(historyClick).toBeGreaterThanOrEqual(0)
    expect(detachTail).toBeGreaterThan(historyClick)
    expect(detachTail).toBeLessThan(requestHistory)
  })

  it('loads the scroll controller and exposes a keyboard-accessible jump to latest', () => {
    const webview = { cspSource: 'vscode-webview:' } as vscode.Webview
    const mark = { toString: () => 'vscode-resource:/deepseek.svg' } as vscode.Uri
    const html = chatHtml(webview, mark)
    expect(html).toContain('src="vscode-resource:/dist/webview/scroll.js"')
    expect(html).toContain('aria-label="Jump to latest" aria-controls="scroll" hidden')
    expect(html).toContain('tabindex="0" aria-label="Conversation"')
    expect(html).toContain('dshConversationScroll.createConversationScroller(')
    expect(html).not.toContain('scheduleTailScroll(Boolean(current.approval || current.question))')
  })
})
