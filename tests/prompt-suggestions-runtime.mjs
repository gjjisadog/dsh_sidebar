// Isolated real-DSH check: fake provider only, no user profiles or credentials.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { startRuntimeFixture } from './runtime-fixture.mjs'
const cli = resolve(process.argv[2])
const root = await mkdtemp(join(tmpdir(), 'dsh-suggestions-'))
let runtime, connection, calls = 0, answer = '帮我补上对应的测试'
const server = createServer(async (request, response) => {
  let data = ''; for await (const chunk of request) data += chunk
  const input = JSON.parse(data)
  assert.equal(input.model, 'fixture')
  assert.equal(input.tools?.length ?? 0, 0)
  assert.match(input.messages[0].content, /Predict the single short message/)
  calls++
  response.writeHead(200, {'content-type':'text/event-stream'})
  response.write(`data: ${JSON.stringify({id:'suggestion',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]})}\n\n`)
  response.end(`data: ${JSON.stringify({id:'suggestion',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`)
})
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  const patch = join(root, 'suggestions.yml')
  await writeFile(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      suggestion-fixture:\n        api: openai-completions\n        apiKeyEnv: FIXTURE_KEY\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models:\n          - id: fixture\n            name: Fixture\n            contextWindow: 65536\n            maxTokens: 1024\n- insert:\n    - id: vscode-prompt-suggestions\n      name: ${JSON.stringify(pathToFileURL(resolve('dist/prompt-suggestions-plugin.mjs')).href)}\n`)
  await build({stdin:{contents:"export {DshConnection} from './src/dsh-connection.ts'",resolveDir:process.cwd(),loader:'ts'},outfile:join(root,'connection.cjs'),bundle:true,platform:'node',format:'cjs',external:['bufferutil','utf-8-validate'],logLevel:'silent'})
  const {DshConnection} = createRequire(import.meta.url)(join(root,'connection.cjs'))
  runtime = await startRuntimeFixture(cli, workspace, {PATH:process.env.PATH,HOME:join(root,'os-home'),DSH_HOME:join(root,'home'),FIXTURE_KEY:'local-test-only',NO_COLOR:'1'}, patch)
  connection = new DshConnection(new URL(runtime.url.origin)); await connection.authenticate(runtime.url)
  const request = {sessionId:'fixture-session',provider:'suggestion-fixture',model:'fixture',messages:[{role:'user',text:'修复这个问题'},{role:'assistant',text:'问题已修复，尚未添加测试。'}]}
  assert.deepEqual(await connection.call('vscodePromptSuggestions/suggest',{request}), {text:answer})
  answer = 'NONE'; assert.deepEqual(await connection.call('vscodePromptSuggestions/suggest',{request}), {text:''})
  answer = '第一行\n第二行'; assert.deepEqual(await connection.call('vscodePromptSuggestions/suggest',{request}), {text:''})
  await assert.rejects(connection.call('vscodePromptSuggestions/suggest',{request:{...request,messages:[{role:'tool',text:'ignored'}]}}))
  assert.equal(calls,3)
  console.log('PASS: authenticated DSH Remote uses selected provider without tools; NONE, multiline and malformed input handled')
} catch(error) { if(runtime) console.error(runtime.diagnostics); throw error }
finally { connection?.dispose(); await runtime?.stop(); await new Promise(resolve => server.close(resolve)); await rm(root,{recursive:true,force:true}) }
