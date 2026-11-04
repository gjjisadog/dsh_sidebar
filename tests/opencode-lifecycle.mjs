// Real persistence checks. No external model calls, inherited keys, or user profiles.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { startRuntimeFixture } from './runtime-fixture.mjs'

assert(process.argv[2], 'Pass an installed DSH lib/bin.js path.')
const cli = resolve(process.argv[2])
const root = await mkdtemp(join(tmpdir(), 'dsh-go-lifecycle-'))
const workspace = join(root, 'workspace'); await mkdir(workspace)
const entry = join(root, 'client.cjs')
await build({ stdin: { contents: `export {DshConnection} from './src/dsh-connection.ts';
export {DshClient} from './src/dsh-client.ts';
export {openCodeRuntimePatch, OPENCODE_DEFAULT_MODEL} from './src/opencode-runtime.ts';`,
  resolveDir: process.cwd(), loader: 'ts' }, outfile: entry, bundle: true, platform: 'node', format: 'cjs',
  external: ['bufferutil', 'utf-8-validate'], logLevel: 'silent' })
const { DshConnection, DshClient, openCodeRuntimePatch, OPENCODE_DEFAULT_MODEL } = createRequire(import.meta.url)(entry)
const patch = join(root, 'go.yml'); await writeFile(patch, openCodeRuntimePatch())
let active, connection, client
async function stop() { client?.dispose(); connection?.dispose(); await active?.stop(); active = undefined }
async function start(key) {
  const env = { DSH_HOME: join(root, 'home'), DSH_CWD: workspace, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' }
  for (const name of ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR']) if (process.env[name]) env[name] = process.env[name]
  if (key) env.OPENCODE_API_KEY = key
  active = await startRuntimeFixture(cli, workspace, env, key ? patch : undefined)
  connection = new DshConnection(new URL(active.url.origin)); await connection.authenticate(active.url)
  client = new DshClient(connection); await client.startStreams()
}
async function open(id) { const opening = await client.openSession(id); opening.activate(); return client.models(id) }
async function selectedDefault(provider) {
  const deadline = Date.now() + 5000
  while (!(await readFile(join(root, 'home', 'profiles', 'web', 'cordis.patch.yml'), 'utf8')).includes(`provider: ${provider}`)) {
    assert(Date.now() < deadline, `Default model ${provider} was not persisted: ${await readFile(join(root, 'home', 'profiles', 'web', 'cordis.patch.yml'), 'utf8')} ${active.diagnostics.slice(-2400)}`); await delay(25)
  }
}
try {
  await start()
  const session = await client.createSession(workspace)
  let original = (await open(session.sessionId)).current
  await stop(); await start('fixture-first-key')
  await open(session.sessionId); await client.selectModel(session.sessionId, OPENCODE_DEFAULT_MODEL)
  await selectedDefault('opencode-go')
  console.log('PASS: first Go configuration persists its model')
  original = (await client.selectModel(session.sessionId, original)).selected
  await stop(); await start('fixture-rotated-key')
  assert.deepEqual((await open(session.sessionId)).current, original)
  console.log('PASS: key rotation and restart preserve the current conversation model')
  await client.selectModel(session.sessionId, OPENCODE_DEFAULT_MODEL); await selectedDefault('opencode-go')
  await stop(); await start()
  await open(session.sessionId)
  const recovered = await client.recoverOpenCodeModel(session.sessionId)
  assert.notEqual(recovered.current.provider, 'opencode-go'); assert.equal(recovered.routable, true)
  await selectedDefault(recovered.current.provider)
  const fresh = await client.createSession(workspace)
  assert.notEqual((await open(fresh.sessionId)).current.provider, 'opencode-go')
  await stop(); await start()
  assert.equal((await open(session.sessionId)).routable, true)
  assert.equal((await open(fresh.sessionId)).routable, true)
  console.log('PASS: clearing Go repairs old/new conversations and survives another restart')
} finally { await stop(); await rm(root, { recursive: true, force: true }) }
