import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const commands = vi.hoisted(()=>({executeCommand:vi.fn(async()=>{})}))
vi.mock('vscode',()=>({commands,Uri:{file:(fsPath:string)=>({fsPath,toString:()=>fsPath}),parse:(uri:string)=>({fsPath:uri,toString:()=>uri})},workspace:{getConfiguration:()=>({inspect:()=>undefined})}}))
import { Workbench } from '../src/workbench.js'
const roots:string[]=[]
afterEach(async()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it('restores complete drafts across modes and hosts without deleting newer input on send acknowledgement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-draft-'));roots.push(root);vi.stubEnv('DSH_HOME',join(root,'dsh'))
 const context={globalStorageUri:{fsPath:root},workspaceState:{get:()=>undefined}} as any
 const controller={cwd:root,state:{sessionId:'s',messages:[],hasMoreHistory:false},start:async()=>{},selectSession:async()=>{}}
 const connection={} as any
 const workbench=new Workbench(context,controller,()=>connection,()=>true)
 const sidebar=workbench.surface('sidebar'),sent:any[]=[]
 const webview={postMessage:async(message:any)=>{sent.push(message);return true}} as any
 await sidebar.restore('s',webview)
 sidebar.images.set('s',[{id:'i',mediaType:'image/png',data:'aW1hZ2U='}])
 await sidebar.handle({type:'workbench-draft',sessionId:'s',text:'first'},webview)
 await sidebar.handle({type:'workbench-draft',sessionId:'s',text:'new input'},webview)
 await sidebar.sent('s','first')
 workbench.mode='client'
 expect(sidebar.active()).toBe(false)
 await workbench.surface('client').restore('s',webview)
 expect(sent.at(-1)).toMatchObject({text:'new input',images:[{data:'aW1hZ2U='}]})
 await workbench.close()
 const reopened=new Workbench(context,controller,()=>connection,()=>true)
 await reopened.surface('sidebar').restore('s',webview)
 expect(sent.at(-1)).toMatchObject({text:'new input',images:[{id:'i',data:'aW1hZ2U='}]})
 await reopened.close()
})

it('hands an exact conversation to a new project window and consumes the startup request once',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-handoff-'));roots.push(root);vi.stubEnv('DSH_HOME',join(root,'dsh'))
 const b=join(root,'b');await mkdir(b)
 const canonicalB=await import('node:fs/promises').then(fs=>fs.realpath(b))
 const context={globalStorageUri:{fsPath:root},workspaceState:{get:()=>undefined}} as any
 const controller={cwd:root,state:{sessionId:'active',messages:[],hasMoreHistory:false},start:async()=>{},selectSession:vi.fn(async()=>{})}
 const connection={call:async()=>({items:[{sessionId:'old-b',cwd:canonicalB,updatedAt:1,blank:false,running:false,projections:{values:{title:'Old B'}}}]})} as any
 const workbench=new Workbench(context,controller,()=>connection,()=>true)
 const catalog=await workbench.catalog(),session=catalog.sessions[0]!
 await workbench.surface('client').handle({type:'workbench-resume',sourceId:session.sourceId,sessionId:session.sessionId},{postMessage:async()=>true} as any)
 expect(commands.executeCommand).toHaveBeenCalledWith('vscode.openFolder',expect.anything(),{forceNewWindow:true})
 expect(controller.selectSession).not.toHaveBeenCalled()
 const destination=new Workbench(context,{...controller,cwd:canonicalB},()=>connection,()=>true)
 expect(await destination.initialize()).toMatchObject({sessionId:'old-b',sourceId:session.sourceId})
 expect(await destination.initialize()).toBeUndefined()
 await workbench.close();await destination.close()
})
