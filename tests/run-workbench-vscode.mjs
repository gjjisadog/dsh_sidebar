// node tests/run-workbench-vscode.mjs /path/to/VSCode/executable
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
const binary=process.argv[2]
assert(binary,'Pass a VS Code executable; no editor is downloaded')
const root=await mkdtemp(join(tmpdir(),'dsh-native-'))
try {
 const user=join(root,'user'),workspace=join(root,'workspace')
 await mkdir(join(user,'User'),{recursive:true});await mkdir(workspace)
 await writeFile(join(user,'User','settings.json'),JSON.stringify({'deepseekHarness.autoStart':false,'deepseekHarness.reuseExistingRuntime':false,'deepseekHarness.executable':join(root,'nonexistent-dsh'),'security.workspace.trust.enabled':false,'telemetry.telemetryLevel':'off','update.mode':'none'}))
 const env={...process.env,DSH_HOME:join(root,'dsh')};delete env.ELECTRON_RUN_AS_NODE
 const code=await new Promise((accept,reject)=>{
   const child=spawn(resolve(binary),['--user-data-dir='+user,'--extensions-dir='+join(root,'extensions'),'--extensionDevelopmentPath='+process.cwd(),'--extensionTestsPath='+resolve('tests/workbench-vscode.cjs'),'--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-gpu',workspace],{env,stdio:'inherit'})
   const timer=setTimeout(()=>{child.kill();reject(new Error('VS Code acceptance test timed out'))},90000)
   child.once('error',error=>{clearTimeout(timer);reject(error)})
   child.once('exit',code=>{clearTimeout(timer);accept(code)})
 })
 assert.equal(code,0)
}finally{await rm(root,{recursive:true,force:true})}
