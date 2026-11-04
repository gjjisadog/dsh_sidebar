// Real Chromium layout/event-order regression tests. Run after `pnpm build`.
// Set DSH_TEST_BROWSER if Chrome/Chromium is installed at a nonstandard path.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import WebSocket from 'ws'

const candidates = [process.env.DSH_TEST_BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
]
const browser = candidates.find(path => path && existsSync(path))
assert.ok(browser, 'Set DSH_TEST_BROWSER to a Chrome/Chromium executable.')
const root = new URL('../', import.meta.url)
const [{ outputFiles }, markdown, scrollBundle] = await Promise.all([
  build({ entryPoints: [fileURLToPath(new URL('src/webview.ts', root))], bundle: true, platform: 'node', format: 'cjs', write: false }),
  readFile(new URL('dist/webview/markdown.js', root), 'utf8'),
  readFile(new URL('dist/webview/scroll.js', root), 'utf8'),
])
const module = { exports: {} }
new Function('module', 'exports', outputFiles[0].text)(module, module.exports)
const uri = name => ({ toString: () => `https://assets.invalid/${name}` })
const html = module.exports.chatHtml({ cspSource: 'https://assets.invalid' }, uri('mark.svg'), {
  script: uri('markdown.js'), style: uri('katex.css'), scroll: uri('scroll.js'),
})
const inline = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1]
// Load the same built scripts explicitly; no external network or VS Code API.
const shell = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '')
const profile = await mkdtemp(join(tmpdir(), 'dsh-scroll-browser-'))
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] })
const exited = once(child, 'exit')
let socket
const timeout = setTimeout(() => { console.error('Browser scroll test timed out'); socket?.terminate(); child.kill(); process.exitCode = 1 }, 60_000)
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''
    child.stderr.on('data', chunk => {
      output += chunk
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) resolve(match[1])
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Browser exited: ${code}`)))
  })
  socket = new WebSocket(endpoint)
  await once(socket, 'open')
  const pending = new Map()
  let id = 0
  socket.on('message', raw => {
    const response = JSON.parse(raw)
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.error) request.reject(new Error(JSON.stringify(response.error)))
    else request.resolve(response.result)
  })
  socket.on('close', () => { for (const request of pending.values()) request.reject(new Error('Browser disconnected')); pending.clear() })
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => call(method, params, sessionId)
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await page('Emulation.setDeviceMetricsOverride', { width: 410, height: 720, deviceScaleFactor: 1, mobile: false })
  await page('Page.enable')
  await page('Page.bringToFront')
  const { frameTree } = await page('Page.getFrameTree')
  await page('Page.setDocumentContent', { frameId: frameTree.frame.id, html: shell })
  await evaluate(`window.sent = []; window.acquireVsCodeApi = () => ({postMessage: message => sent.push(message)});
    document.documentElement.style.cssText = '--vscode-foreground:#cccccc;--vscode-sideBar-background:#181818;--vscode-editor-background:#202020;--vscode-font-family:Arial;--vscode-editor-font-family:monospace;--vscode-descriptionForeground:#999;--vscode-widget-border:#454545;--vscode-focusBorder:#4d6bfe;--vscode-button-secondaryBackground:#333;--vscode-button-secondaryForeground:#fff;--vscode-button-secondaryHoverBackground:#454545;--vscode-widget-shadow:#0006;--vscode-textLink-foreground:#65aaff';`)
  await evaluate(markdown); await evaluate(scrollBundle); await evaluate(inline)
  await evaluate(`window.tick = (ms = 90) => new Promise(resolve => setTimeout(resolve, ms));
    window.ensure = (value, message) => { if (!value) throw new Error(message); };
    window.gap = () => elements.scroll.scrollHeight - elements.scroll.scrollTop - elements.scroll.clientHeight;
    window.baseline = {phase:'ready',sessionId:'a',workspaceName:'scroll-demo',cwd:'/demo',sessions:[{id:'a',title:'Auto-scroll regression'}],models:[],permissions:[],commands:[],skills:[],queue:[],changedFiles:[],messages:[{id:'reply',role:'assistant',text:'# Streaming reply\\n\\n' + 'Paragraph of output.\\n\\n'.repeat(40),streaming:true}]};
    window.showState = value => window.dispatchEvent(new MessageEvent('message', {data:{type:'state',state:value}}));
    showState(baseline);`)
  await evaluate('tick()')
  assert.equal(await evaluate('gap() <= 2 && conversationScroller.following'), true)

  // The actual production controller, with two renders bracketing its rAF write.
  await evaluate(`(async () => {
    const append = () => { const row = document.createElement('div'); row.style.height='160px'; elements.messages.append(row); };
    await new Promise(resolve => requestAnimationFrame(() => {
      append(); conversationScroller.changed();
      requestAnimationFrame(() => { append(); conversationScroller.changed(); resolve(); });
    }));
    await tick(); ensure(conversationScroller.following && gap() <= 2, 'issue #30: lost follow intent');
  })()`)
  console.log('PASS: programmatic scroll + overlapping streamed layout (#30)')

  // Browser-dispatched wheel input, not a synthetic scroll callback.
  await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 220, deltaX: 0, deltaY: -220 })
  await evaluate('tick()')
  assert.equal(await evaluate('!conversationScroller.following && gap() > 100'), true)
  await evaluate(`window.readingTop = elements.scroll.scrollTop; showState({...baseline,messages:[...baseline.messages,{id:'table',role:'assistant',text:'| Item | Value |\\n| --- | --- |\\n' + '| Result | 123 |\\n'.repeat(30)}]});`)
  await evaluate('tick()')
  assert.equal(await evaluate('!conversationScroller.following && Math.abs(elements.scroll.scrollTop-readingTop)<2 && !document.getElementById("jumpLatest").hidden'), true)
  console.log('PASS: native upward wheel + large Markdown table keeps the reader in place')

  await evaluate(`document.getElementById('jumpLatest').focus()`)
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await evaluate('tick()')
  assert.deepEqual(await evaluate('({following:conversationScroller.following, atBottom:gap()<=2, focus:document.activeElement.id})'), {following:true,atBottom:true,focus:'scroll'})
  console.log('PASS: keyboard-activated Jump to latest restores following and focus')

  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 })
  await evaluate('tick(200)')
  assert.equal(await evaluate('!conversationScroller.following && gap() > 20'), true)
  console.log('PASS: native keyboard navigation pauses following')

  await evaluate(`(async () => {
    showState({...baseline,sessionId:'tools',messages:[...baseline.messages,{id:'tool',role:'tool',text:'Read file',rawResult:'output\\n'.repeat(30)}]}); await tick();
    const tool = document.querySelector('details.tool'); tool.querySelector('summary').click(); await tick();
    ensure(!conversationScroller.following && tool.open, 'manual expansion must preserve reading');
    conversationScroller.resume(); await tick();
    showState({...state,messages:[...state.messages,{id:'auto-tool',role:'tool',text:'Running',streaming:true,rawResult:'running\\n'.repeat(20)}]}); await tick();
    ensure(conversationScroller.following && gap() <= 2, 'automatic expansion lost follow');
    const canvas = document.createElement('canvas'); canvas.width=100; canvas.height=240;
    const image = new Image(); const loaded = new Promise(resolve => { image.onload=resolve; });
    elements.messages.append(image); image.src=canvas.toDataURL(); await loaded; await tick();
    ensure(conversationScroller.following && gap() <= 2, 'image decode lost follow');
    elements.prompt.style.height='200px'; await tick();
    ensure(conversationScroller.following && gap() <= 2, 'composer resize lost follow');
    elements.prompt.style.height='';
    elements.prompt.value = 'A new message'; send('queue'); const request = sent.findLast(message => message.type === 'send');
    conversationScroller.pause();
    window.dispatchEvent(new MessageEvent('message',{data:{type:'draft-sent',requestId:request.requestId,sessionId:state.sessionId}})); await tick();
    ensure(!conversationScroller.following, 'late send receipt overrode user intent');
    elements.prompt.value = 'Follow this reply'; send('queue'); const next = sent.findLast(message => message.type === 'send');
    window.dispatchEvent(new MessageEvent('message',{data:{type:'draft-sent',requestId:next.requestId,sessionId:state.sessionId}})); await tick();
    ensure(conversationScroller.following && gap() <= 2, 'accepted send did not resume following');
    conversationScroller.pause(); elements.scroll.scrollTop -= 200; await tick(); const reading = elements.scroll.scrollTop;
    showState({...state,approval:{rpcId:'approval',approvalId:'one',toolName:'Write',reason:'Review this change'},question:{rpcId:'question',questions:[{id:'q',question:'Continue?'}]}}); await tick();
    showState({...state,usage:{available:false}}); await tick();
    ensure(!conversationScroller.following && Math.abs(elements.scroll.scrollTop-reading)<2, 'approval/question refresh stole scroll position');
    showState({...baseline,sessionId:'history',hasMoreHistory:true}); await tick();
    elements.scroll.scrollTop=150; await tick(); document.querySelector('.history-button').click();
    const before = document.querySelector('[data-scroll-id="reply"]').getBoundingClientRect().top;
    showState({...state,hasMoreHistory:false,loadingHistory:false,messages:[{id:'older',role:'assistant',text:'Older message\\n\\n'.repeat(20)},...state.messages,{id:'new-tail',role:'assistant',text:'New output\\n\\n'.repeat(10)}]}); await tick();
    ensure(Math.abs(document.querySelector('[data-scroll-id="reply"]').getBoundingClientRect().top-before)<2, 'history anchor drifted');
    ensure(!conversationScroller.following, 'history restore resumed following');
    showState({...baseline,sessionId:'final'}); await tick(); ensure(conversationScroller.following && gap()<=2, 'session reset failed');
    ensure(!sent.some(message => message.type==='webview-error'), JSON.stringify(sent.filter(message => message.type==='webview-error')));
  })()`)
  console.log('PASS: tools, image decode, composer resize, send receipts, approvals, history and session switching')
  await page('Emulation.setDeviceMetricsOverride', { width: 300, height: 550, deviceScaleFactor: 1, mobile: false })
  await evaluate('tick()')
  assert.equal(await evaluate('conversationScroller.following && gap() <= 2'), true)
  await evaluate('conversationScroller.pause(); elements.scroll.scrollTop -= 180;')
  await evaluate('tick()')
  assert.equal(await evaluate(`(() => { const b=document.getElementById('jumpLatest').getBoundingClientRect(), s=elements.scroll.getBoundingClientRect(); return b.width>0 && b.left>=s.left && b.right<=s.right && b.bottom<=s.bottom; })()`), true)
  console.log('PASS: narrow sidebar resize and visible, in-bounds button')
  await evaluate(`(async () => {
    document.documentElement.lang = 'zh-cn';
    const diagnostics = { provider: 'opencode-go', model: 'deepseek-v4.1-flash', version: '0.2.0-rc.2', ownership: 'managed', credential: 'saved', recovered: false };
    for (const health of ['unverified', 'verified', 'quota', 'auth', 'network']) {
      showState({...state, diagnostics: {...diagnostics, health}, credentialPending: true}); await tick();
      ensure(!document.getElementById('diagnostics') && !document.querySelector('.diagnostic-action'), 'service status bar returned');
      ensure(document.documentElement.scrollWidth <= innerWidth, 'composer overflow narrow sidebar');
      const bounds = elements.prompt.getBoundingClientRect();
      ensure(bounds.top >= 0 && bounds.bottom <= innerHeight, 'composer is outside the viewport');
    }
    ensure(!sent.some(message => message.type === 'webview-error'), 'removing status bar caused webview error');
  })()`)
  console.log('PASS: no service status bar for normal, error or pending credentials; narrow composer remains usable')
  await evaluate(`(async () => {
    showState({...baseline, sessionId:'compact-tools', messages:[
      {id:'request',role:'user',text:'检查 ctrl.c 的母线就绪判断'},
      {id:'explanation',role:'assistant',text:'我会先查看项目目录，再检查这段判断的条件。'},
      {id:'inspect',role:'tool',text:'pwsh',detail:'Completed',callView:{card:'terminal',title:'cd /Volumes/KIOXIA_WORK/Hybrid30 && ls',description:'查看项目目录'},resultView:{card:'terminal',output:'AGENTS.md  build  platform  project  tests\\nctrl.c  ctrl.h  ctrl_offgrid.c',exitCode:0}},
      {id:'source',role:'tool',text:'pwsh',detail:'Completed',callView:{card:'terminal',title:'sed -n 540,700p project/hybrid30k/modules/cpu1/ctrl/ctrl.c',description:'查看母线就绪判断'},resultView:{card:'terminal',output:'    int32_t lBusFlt = pstCtrl->stSample.stPrt.iBusVoltFlt;\\n\\n' + '    if ((pstCtrl->iVbusRefSet > 0) && (lTarget > OFFGRID_BUS_READY_MARGIN)) {\\n        update_bus_status(pstCtrl);\\n    }\\n'.repeat(30),exitCode:0}}
    ]}); await tick();
    const tools = [...document.querySelectorAll('details.tool')];
    ensure(tools.length === 2 && tools.every(tool => !tool.open && tool.getBoundingClientRect().height <= 30), 'completed tools should be compact rows');
    ensure(!tools.some(tool => tool.textContent.includes('Completed')), 'duplicate completion labels remain');
    tools[1].querySelector('summary').focus();
  })()`)
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await evaluate(`(async () => {
    await tick();
    const tool = document.querySelectorAll('details.tool')[1], body = tool.querySelector('.tool-body'), pre = body.querySelector('pre');
    ensure(tool.open && body.scrollHeight > body.clientHeight && body.clientHeight <= 320, 'expanded tool output is not height limited');
    ensure(getComputedStyle(pre).fontSize === '11px' && getComputedStyle(pre).lineHeight === '18px' && getComputedStyle(pre).fontFamily.includes('monospace'), 'output must use compact monospace type');
    ensure(body.textContent.includes('$ sed -n') && !body.textContent.includes('Exit 0'), 'full command missing or duplicate exit status remains');
    ensure(document.documentElement.scrollWidth <= innerWidth, 'tool output overflowed narrow sidebar');
  })()`)
  console.log('PASS: compact tool rows, keyboard expansion, complete command, monospace output, bounded height and narrow layout')
  if (process.env.DSH_TOOL_SCREENSHOT) {
    await page('Emulation.setDeviceMetricsOverride', { width: 720, height: 720, deviceScaleFactor: 1, mobile: false })
    await evaluate('tick()')
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.DSH_TOOL_SCREENSHOT, Buffer.from(data, 'base64'))
  }
  await evaluate(`(async () => {
    const bash = {id:'hidden-shell',role:'tool',text:'bash',detail:'Completed',deferredBody:true,callView:{card:'terminal',title:'hidden command'}};
    showState({...baseline,sessionId:'hide-bash',messages:[{id:'question',role:'user',text:'解释这段代码'},bash,{id:'answer',role:'assistant',text:'这里是代码说明。'}]}); await tick();
    ensure(!document.querySelector('details.tool') && !elements.messages.textContent.includes('hidden command'), 'historical Bash record remains visible');
    for (const patch of [{streaming:true,detail:'Running…'},{failed:true,detail:'Failed'}]) {
      showState({...state,messages:state.messages.map(message => message.id === bash.id ? {...bash,...patch} : message)}); await tick();
      ensure(!document.querySelector('details.tool'), 'running or failed Bash record became visible');
    }
    ensure(elements.messages.querySelectorAll('.message').length === 2 && elements.messages.textContent.includes('这里是代码说明。'), 'hiding Bash removed dialogue');
    ensure(state.messages.length === 3 && !sent.some(message => message.type === 'load-tool-output' && message.messageId === bash.id), 'Bash history changed or hidden output was loaded');
    showState({...state,messages:[...state.messages,{id:'visible-read',role:'tool',text:'read',callView:{card:'generic',title:'Read ctrl.c'}}]}); await tick();
    ensure(document.querySelectorAll('details.tool').length === 1, 'unrelated tool was hidden');
  })()`)
  console.log('PASS: Bash history, running and failed calls are hidden; dialogue, stored history and other tools are preserved')
  await evaluate(`(async () => {
    showState({...baseline,sessionId:'suggestions',running:false,messages:[{id:'u',role:'user',text:'修复问题'},{id:'a',role:'assistant',text:'问题已修复，尚未添加测试。'}]});
    await tick(650);
    window.suggestionRequest = sent.findLast(message => message.type === 'suggest-prompt');
    ensure(suggestionRequest && suggestionRequest.sessionId === 'suggestions', 'missing next-prompt request');
    window.deliverSuggestion = (request = suggestionRequest) => window.dispatchEvent(new MessageEvent('message',{data:{type:'prompt-suggestion',...request,text:'帮我补上对应的测试',type:'prompt-suggestion'}}));
    deliverSuggestion();
    ensure(elements.prompt.value === '' && elements.prompt.placeholder.includes('帮我补上对应的测试'), 'suggestion should only be ghost text');
    elements.prompt.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',isComposing:true,bubbles:true,cancelable:true}));
    ensure(elements.prompt.value === '', 'IME Tab must not accept');
    elements.prompt.focus(); window.sendsBeforeTab = sent.filter(message => message.type === 'send').length;
  })()`)
  await page('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await page('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
  await evaluate(`(async () => {
    ensure(elements.prompt.value === '帮我补上对应的测试' && document.activeElement === elements.prompt, 'native Tab did not accept into the draft');
    ensure(sent.filter(message => message.type === 'send').length === sendsBeforeTab, 'accepting suggestion sent it automatically');
    elements.prompt.value='我的草稿'; elements.prompt.dispatchEvent(new Event('input',{bubbles:true})); deliverSuggestion();
    ensure(elements.prompt.value === '我的草稿' && !elements.prompt.placeholder.includes('帮我'), 'late suggestion overwrote typing');
    elements.prompt.value=''; showState({...state,messages:[...state.messages,{id:'a2',role:'assistant',text:'接下来可以补充测试。'}]}); await tick(650);
    suggestionRequest = sent.findLast(message => message.type === 'suggest-prompt'); deliverSuggestion(); elements.prompt.focus();
  })()`)
  await page('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await page('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await evaluate(`(async () => {
    ensure(!elements.prompt.placeholder.includes('帮我'), 'Escape did not dismiss'); deliverSuggestion();
    ensure(!elements.prompt.placeholder.includes('帮我'), 'dismissed response returned');
    showState({...baseline,sessionId:'another-session',messages:[]}); await tick(); deliverSuggestion();
    ensure(elements.prompt.value === '' && !elements.prompt.placeholder.includes('帮我'), 'suggestion leaked across sessions');
    const beforeDisabled = sent.filter(message => message.type === 'suggest-prompt').length;
    window.dispatchEvent(new MessageEvent('message',{data:{type:'suggestion-setting',enabled:false}}));
    showState({...state,messages:[{id:'u3',role:'user',text:'测试'},{id:'a3',role:'assistant',text:'可以补上测试。'}]}); await tick(650);
    ensure(sent.filter(message => message.type === 'suggest-prompt').length === beforeDisabled, 'disabled setting still requests suggestions');
    deliverSuggestion(); ensure(!elements.prompt.placeholder.includes('帮我'), 'disabled setting accepted a stale suggestion');
    ensure(!sent.some(message => message.type === 'webview-error'), 'suggestion caused a webview error');
  })()`)
  console.log('PASS: context suggestion, native Tab acceptance without sending, IME protection, typing, Escape and session isolation')
  await evaluate(`showState({...baseline,sessionId:'usage-redesign',messages:[{id:'q',role:'user',text:'解释这段代码'},{id:'r',role:'assistant',text:'这段代码检查母线电压是否满足就绪条件。'}],usage:{available:true,percent:20,usedTokens:40000,contextWindow:200000,breakdown:{systemTokens:5000,toolsTokens:10000,messageTokens:25000},tokenUsage:{uncachedInputTokens:100000,cacheReadTokens:80000,cacheWriteTokens:0,outputTokens:24000},sessionStats:{turns:2,steps:13,llmMs:1000,toolMs:1000,ttftMs:0,ttftSteps:0,decodeMs:0,decodeTokens:0}}});`)
  for (const width of [300, 720]) {
    await page('Emulation.setDeviceMetricsOverride', {width,height:720,deviceScaleFactor:1,mobile:false})
    await evaluate(`(async () => { await tick();
      ensure(document.getElementById('usagePercent').textContent==='20%', 'context numbers are unclear');
      ensure(elements.usageStats.textContent==='累计 204K tokens', 'session total confused with context usage');
      ensure(document.getElementById('usageTrack').getAttribute('aria-valuenow')==='20', 'progress accessibility value missing');
      ensure(document.documentElement.scrollWidth<=innerWidth && elements.usageTrigger.scrollWidth<=elements.usageTrigger.clientWidth, 'usage row overflows');
      elements.usageTrigger.click(); await tick(); const panel=elements.usagePanel.getBoundingClientRect();
      ensure(elements.usagePanel.querySelector('.usage-capacity').textContent==='~40K / 200K tokens', 'capacity missing from usage details');
      ensure(!elements.usagePanel.classList.contains('hidden') && panel.left>=0 && panel.right<=innerWidth && panel.top>=0, 'usage details leave the viewport');
      const topElement = document.elementFromPoint(panel.left + 12, panel.top + 12);
      ensure(elements.usagePanel.contains(topElement), 'usage details are clipped or covered');
      ensure(document.getElementById('usageFooter').getBoundingClientRect().height <= 28 && elements.usageTrigger.getBoundingClientRect().width < 140, 'usage should stay compact');
      ensure(elements.usagePanel.textContent.includes('剩余空间~160K') && elements.usagePanel.textContent.includes('不等于上下文占用'), 'usage explanations missing');
      elements.usageTrigger.click(); await tick();
    })()`)
  }
  console.log('PASS: visible context percentage and capacity, separate session totals, accessible progress and responsive details')
  if (process.env.DSH_USAGE_SCREENSHOT) {
    const {data}=await page('Page.captureScreenshot',{format:'png'})
    await writeFile(process.env.DSH_USAGE_SCREENSHOT,Buffer.from(data,'base64'))
    await evaluate('elements.usageTrigger.click(); tick()')
    const opened = await page('Page.captureScreenshot',{format:'png'})
    await writeFile(process.env.DSH_USAGE_SCREENSHOT.replace('.png','-details.png'),Buffer.from(opened.data,'base64'))
  }
  if (process.env.DSH_SCROLL_SCREENSHOT) {
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.DSH_SCROLL_SCREENSHOT, Buffer.from(data, 'base64'))
  }
} finally {
  clearTimeout(timeout)
  socket?.terminate()
  child.kill()
  await exited
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
