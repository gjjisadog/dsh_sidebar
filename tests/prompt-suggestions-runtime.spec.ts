import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const config = vi.hoisted(() => ({ enabled: true }))
vi.mock('vscode', () => ({ Uri: { file: (fsPath: string) => ({ fsPath }) }, workspace: { getConfiguration: () => ({ get: () => config.enabled }) } }))
import { PromptSuggestionsRuntimeContribution } from '../src/prompt-suggestions-runtime.js'
let storage = ''
afterEach(async () => { config.enabled = true; if (storage) await rm(storage, { recursive: true, force: true }) })
describe('suggestion runtime overlay', () => {
  it('composes the existing launch and removes only its private patch on disposal', async () => {
    storage = await mkdtemp(join(tmpdir(), 'dsh-suggest-test-'))
    const dispose = vi.fn()
    const inner = { environment: { EXISTING: 'value' }, transformArguments: (args: readonly string[]) => [...args, '--existing'], dispose }
    const runtime = new PromptSuggestionsRuntimeContribution({ extensionUri: { fsPath: '/extension with spaces' }, globalStorageUri: { fsPath: storage } } as never, { prepare: async () => inner })
    const prepared = (await runtime.prepare({ workspacePath: '/project', configuredExecutable: '', configuredArguments: ['web'] }))!
    const args = prepared.transformArguments(['web'], '0.2.1-rc.2')
    expect(args.slice(0, 2)).toEqual(['web', '--patch'])
    expect(args.at(-1)).toBe('--existing')
    expect(prepared.environment).toEqual(inner.environment)
    expect(await readFile(args[2]!, 'utf8')).toContain('file:///extension%20with%20spaces/dist/prompt-suggestions-plugin.mjs')
    await prepared.dispose?.()
    expect(dispose).toHaveBeenCalledOnce()
    expect(await readdir(storage)).toEqual([])
  })
  it('does not change the runtime launch when suggestions are disabled', async () => {
    config.enabled = false
    const inner = { transformArguments: (args: readonly string[]) => args }
    const runtime = new PromptSuggestionsRuntimeContribution({} as never, { prepare: async () => inner })
    expect(await runtime.prepare({ workspacePath: '/project', configuredExecutable: '', configuredArguments: ['web'] })).toBe(inner)
  })
})
