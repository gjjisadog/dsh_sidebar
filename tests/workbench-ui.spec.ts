import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { chatHtml } from '../src/webview.js'
import { workbenchScript } from '../src/workbench-ui.js'
import manifest from '../package.json'
it('gates only the DSH view and gives client mode a permanent project navigator', () => {
  expect(manifest.contributes.views.deepseekHarness[0]?.when).toBe('deepseekHarness.presentationMode != client')
  const uri = {toString:()=>''} as any
  const html=(mode:'sidebar'|'client')=>chatHtml({cspSource:'test:'} as any,uri,{script:uri,style:uri,scroll:uri},'zh',mode)
  expect(html('client')).toContain('id="workbenchNav"')
  expect(html('sidebar')).not.toContain('<nav id="workbenchNav"')
  expect(html('client')).toContain('只读历史预览')
})
it('preview actions are read-only and use text nodes for untrusted history', () => {
  const dom = new JSDOM('<button id="workbenchMode"></button><textarea id="prompt"></textarea><div id="scroll"></div><section id="workbenchPreview"></section>')
  try {
    const sent:unknown[]=[]
    const elements={prompt:dom.window.document.getElementById('prompt'),scroll:dom.window.document.getElementById('scroll')}
    new Function('window','document','vscode','elements','state','sessionDrafts','draftImagesBySession','requestAnimationFrame',
      workbenchScript)(dom.window,dom.window.document,{getState:()=>({}),setState(){},postMessage:(message:unknown)=>sent.push(message)},elements,{sessionId:'active'},new Map(),new Map(),()=>{})
    dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data:{type:'workbench-preview',session:{title:'<img src=x onerror=alert(1)>',cwd:'/other',sourceId:'source',sessionId:'cold'},messages:[{role:'user',text:'<script>bad()</script>'}],hasMore:false}}))
    expect(dom.window.document.querySelector('#workbenchPreview img')).toBeNull()
    expect(dom.window.document.querySelector('#workbenchPreview script')).toBeNull()
    expect(sent).toEqual([])
    ;(dom.window.document.getElementById('workbenchMode') as HTMLButtonElement).click()
    expect(sent.at(-1)).toEqual({type:'workbench-mode',text:''})
  } finally {dom.window.close()}
})
