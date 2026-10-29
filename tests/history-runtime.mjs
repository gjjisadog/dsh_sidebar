// Isolated cold-history contract check. No provider keys or model calls.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { startRuntimeFixture } from './runtime-fixture.mjs'
const cli = process.argv[2]
assert(cli, 'Pass an installed DSH lib/bin.js')
const root = await mkdtemp(join(tmpdir(),'dsh-cold-history-'))
let runtime, connection
try {
  const workspace=join(root,'workspace');await mkdir(workspace)
  await build({stdin:{contents:"export { DshConnection } from './src/dsh-connection.ts'; export { DshStreams } from './src/dsh-streams.ts'; export { HistoryReader } from './src/history-reader.ts'",resolveDir:process.cwd()},outfile:join(root,'reader.cjs'),bundle:true,platform:'node',format:'cjs'})
  const {default:api}=await import(join(root,'reader.cjs'))
  const env={PATH:process.env.PATH,DSH_HOME:join(root,'dsh'),HOME:join(root,'home'),NO_COLOR:'1',DSH_TELEMETRY_DISABLED:'1'}
  const connect=async()=>{runtime=await startRuntimeFixture(resolve(cli),workspace,env);connection=new api.DshConnection(new URL(runtime.url.origin));await connection.authenticate(runtime.url)}
  await connect()
  const {sessionId}=await connection.call('session/create',{request:{cwd:workspace}})
  connection.dispose();await runtime.stop()
  await connect()
  const baseline=()=>new Promise((accept,reject)=>{const streams=new api.DshStreams(connection,reject);streams.open('session/control',{},frame=>{if(frame.type==='baseline'){accept(Object.keys(frame.value.projections).length);streams.dispose()}},reject)})
  assert.equal(await baseline(),0,'cold fixture has no active Agents')
  const before=(await connection.call('session/list',{_request:{}})).items
  assert(before.some(s=>s.sessionId===sessionId),'persisted session survives restart')
  const result=await new api.HistoryReader(connection).page(sessionId)
  assert(Array.isArray(result.events));assert.equal(typeof result.hasMore,'boolean')
  const after=(await connection.call('session/list',{_request:{}})).items
  assert.equal(after.length,before.length)
  assert.equal(await baseline(),0,'read-only projections/page must not promote an Agent')
  assert(after.every(s=>!s.running),'preview must not run tasks')
  console.log('Cold history projections/page contract passed; no prompts submitted.')
} finally {connection?.dispose();await runtime?.stop();await rm(root,{recursive:true,force:true})}
