import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENCODE_API_KEY_SECRET } from '../src/credentials.js'
import { OpenCodeRuntimeContribution, OPENCODE_DEFAULT_MODEL } from '../src/opencode-runtime.js'
import type { RuntimeLaunchPreparation } from '../src/runtime-launch.js'

let storage: string
const launch = { workspacePath: '/workspace', configuredExecutable: '', configuredArguments: ['web', '--port', '0'] }
beforeEach(async () => { storage = await mkdtemp(join(tmpdir(), 'dsh-opencode-test-')) })
afterEach(async () => { await rm(storage, { recursive: true, force: true }) })

function contribution(key?: string, debug?: RuntimeLaunchPreparation) {
  const get = vi.fn(async () => key)
  const prepare = vi.fn(async () => debug)
  const instance = new OpenCodeRuntimeContribution({
    secrets: { get }, globalStorageUri: { fsPath: storage },
  } as never, { prepare })
  return { instance, get, prepare }
}

describe('OpenCode Go managed runtime overlay', () => {
  it('keeps the original launch and debug contribution when no Go credential is stored', async () => {
    const debug = { transformArguments: (args: readonly string[]) => [...args, '--debug-fixture'] }
    const h = contribution(undefined, debug)
    expect(await h.instance.prepare(launch)).toBe(debug)
    expect(h.get).toHaveBeenCalledWith(OPENCODE_API_KEY_SECRET)
    expect(await readdir(storage)).toEqual([])
  })

  it('keeps the key in the process environment and cleans up its private, credential-free overlay', async () => {
    const h = contribution(' sk-go-fixture ')
    const prepared = (await h.instance.prepare(launch))!
    const args = prepared.transformArguments(launch.configuredArguments, '0.2.0-rc.2')
    expect(args.slice(0, 2)).toEqual(['web', '--patch'])
    expect(args.slice(3)).toEqual(['--port', '0'])
    const patch = await readFile(args[2]!, 'utf8')
    expect(prepared.environment).toEqual({ OPENCODE_API_KEY: 'sk-go-fixture' })
    expect(JSON.stringify(args) + patch).not.toContain('sk-go-fixture')
    expect(patch).toContain(OPENCODE_DEFAULT_MODEL.model)
    expect(patch).toContain('opencode.ai/inference/go/v1')
    expect(patch).not.toContain('opencode.ai/zen/v1')
    if (process.platform !== 'win32') expect((await stat(args[2]!)).mode & 0o777).toBe(0o600)
    await prepared.dispose?.()
    expect(await readdir(storage)).toEqual([])
  })

  it('composes the Go overlay with the existing debugger and disposes both', async () => {
    const dispose = vi.fn(async () => {})
    const debug = { environment: { DSH_VSCODE_DEBUG_TOKEN: 'debug-token' },
      transformArguments: (args: readonly string[]) => [args[0]!, '--patch', '/debug.yml', ...args.slice(1)], dispose }
    const prepared = (await contribution('sk-test', debug).instance.prepare(launch))!
    expect(prepared.environment).toEqual({ DSH_VSCODE_DEBUG_TOKEN: 'debug-token', OPENCODE_API_KEY: 'sk-test' })
    const args = prepared.transformArguments(launch.configuredArguments, '0.2.0')
    expect(args).toContain('/debug.yml')
    expect(args.filter(arg => arg === '--patch')).toHaveLength(2)
    await prepared.dispose?.()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(await readdir(storage)).toEqual([])
  })

  it('removes the overlay even if debugger cleanup fails', async () => {
    const debug = { transformArguments: (args: readonly string[]) => args, dispose: async () => { throw new Error('debug cleanup') } }
    const prepared = (await contribution('sk-test', debug).instance.prepare(launch))!
    await expect(prepared.dispose?.()).rejects.toThrow('debug cleanup')
    expect(await readdir(storage)).toEqual([])
  })

  it('releases the debugger when overlay creation fails', async () => {
    const dispose = vi.fn(async () => {})
    const debug = { transformArguments: (args: readonly string[]) => args, dispose }
    const h = contribution('sk-test', debug)
    await rm(storage, { recursive: true }); await writeFile(storage, 'not a directory')
    await expect(h.instance.prepare(launch)).rejects.toThrow()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('supports both Web launch dialects and rejects releases without the native Go adapter', async () => {
    const prepared = (await contribution('sk-test').instance.prepare(launch))!
    expect(prepared.transformArguments(['--profile', 'web', '--port', '0'], '0.2.0').slice(0, 3))
      .toEqual(['--profile', 'web', '--patch'])
    for (const version of ['0.1.5-rc.1', '0.2.0-rc.1', undefined, 'custom']) {
      expect(() => prepared.transformArguments(['web'], version)).toThrow('0.2.0-rc.2')
    }
    for (const version of ['0.2.0-rc.2', '0.2.0', '0.2.1', 'dsh v1.0.0']) {
      expect(() => prepared.transformArguments(['web'], version)).not.toThrow()
    }
    expect(() => prepared.transformArguments(['headless'], '0.2.0')).toThrow('Web profile')
    await prepared.dispose?.()
  })
})
