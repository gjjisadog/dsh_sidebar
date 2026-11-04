import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENCODE_API_KEY_SECRET } from '../src/credentials.js'
const info = vi.hoisted(() => vi.fn())
vi.mock('vscode', () => ({ env: { language: 'en' }, window: { showInformationMessage: info, showWarningMessage: vi.fn(), showInputBox: vi.fn(async () => 'fake-new-key') } }))
import { configureApiKey, watchCredentialChanges } from '../src/runtime-configuration.js'

function harness() {
  vi.useFakeTimers()
  let onSecret: (event: { key: string }) => void = () => {}, onState = () => {}
  const disposeSecret = vi.fn(), disposeState = vi.fn()
  const secrets = { get: vi.fn(async () => 'new-fake-key'), onDidChange: vi.fn(callback => { onSecret = callback; return { dispose: disposeSecret } }) }
  const controller = {
    cwd: '/project', isDisposed: false, runtimeOwnership: 'managed' as 'managed' | 'external', runtimeIdentity: {},
    hasRunningTasks: false, state: { phase: 'ready' as 'ready' | 'loading' | 'error', statusText: '' },
    credentialApplied: vi.fn(() => false), setCredentialPending: vi.fn(),
    onDidChangeState: vi.fn(callback => { onState = callback; return { dispose: disposeState } }),
    restart: vi.fn(async () => { controller.credentialApplied.mockReturnValue(true); onState(); return true }),
  }
  const output = { appendLine: vi.fn() }
  const subscription = watchCredentialChanges(controller, secrets as any, output as any)
  return { secrets, controller, output, subscription, disposeSecret, disposeState,
    change: (key = OPENCODE_API_KEY_SECRET) => onSecret({ key }), state: () => onState(), tick: () => vi.advanceTimersByTimeAsync(300) }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks() })
describe('cross-window credentials', () => {
  it('applies a changed key exactly once and clears pending state', async () => {
    const h = harness(); h.change(); await h.tick(); await h.tick()
    expect(h.controller.restart).toHaveBeenCalledTimes(1)
    expect(h.controller.setCredentialPending).toHaveBeenLastCalledWith(false)
    expect(JSON.stringify(h.output.appendLine.mock.calls)).not.toContain('new-fake-key')
    h.subscription.dispose()
  })
  it('waits for tasks and background jobs to settle before restarting', async () => {
    const h = harness(); h.controller.hasRunningTasks = true; h.change(); await h.tick()
    expect(h.controller.restart).not.toHaveBeenCalled()
    expect(h.controller.setCredentialPending).toHaveBeenCalledWith(true)
    h.controller.hasRunningTasks = false; h.state(); await h.tick()
    expect(h.controller.restart).toHaveBeenCalledOnce(); h.subscription.dispose()
  })
  it.each(['external', 'same-key', 'unrelated', 'disposed'] as const)('does not restart for %s', async reason => {
    const h = harness()
    if (reason === 'external') h.controller.runtimeOwnership = 'external'
    if (reason === 'same-key') h.controller.credentialApplied.mockReturnValue(true)
    h.change(reason === 'unrelated' ? 'unrelated' : undefined)
    if (reason === 'disposed') h.subscription.dispose()
    await h.tick(); expect(h.controller.restart).not.toHaveBeenCalled(); h.subscription.dispose()
  })
  it('waits until a loading runtime becomes ready', async () => {
    const h = harness(); h.controller.state.phase = 'loading'; h.change(); await h.tick()
    expect(h.controller.restart).not.toHaveBeenCalled()
    h.controller.state.phase = 'ready'; h.state(); await h.tick()
    expect(h.controller.restart).toHaveBeenCalledOnce(); h.subscription.dispose()
  })
  it('does not duplicate the restart triggered by this window saving its own key', async () => {
    const h = harness()
    const secrets = Object.assign(h.secrets, { store: vi.fn(async () => { h.change(); await h.tick() }) })
    await configureApiKey(h.controller as any, secrets as any, h.output as any, 'opencode-go')
    await h.tick()
    expect(h.controller.restart).toHaveBeenCalledOnce(); h.subscription.dispose()
  })
  it('ignores a stale credential read after disposal', async () => {
    const h = harness(); const finish: Array<(value: string) => void> = []
    h.secrets.get.mockImplementation(() => new Promise(resolve => { finish.push(resolve) }))
    h.change(); await h.tick(); h.subscription.dispose(); finish.forEach(resolve => resolve('fake')); await Promise.resolve()
    expect(h.controller.restart).not.toHaveBeenCalled()
    expect(h.disposeSecret).toHaveBeenCalled(); expect(h.disposeState).toHaveBeenCalled()
  })
})
