import { uiText } from './ui-text.js'
import * as vscode from 'vscode'
import { DEEPSEEK_API_KEY_SECRET, normalizeDeepSeekApiKey, normalizeOpenCodeApiKey, OPENCODE_API_KEY_SECRET } from './credentials.js'
import { OPENCODE_DEFAULT_MODEL } from './opencode-runtime.js'
import type { ModelSelection } from './dsh-client.js'
import type { RuntimeTarget } from './runtime-target.js'
import {
  isCurrentRuntimeTarget,
  restartAfterRuntimeChange,
  runtimeChangeTarget,
  type RuntimeChangeController,
} from './runtime-change.js'

interface ConfigurationController extends RuntimeChangeController {
  start(): Promise<void>
  restart(target?: RuntimeTarget): Promise<boolean>
  selectModel(selection: ModelSelection): Promise<void>
}

type CredentialProvider = 'deepseek' | 'opencode-go'
const credentialUpdates = new WeakMap<vscode.SecretStorage, number>()

async function updatingCredentials<T>(secrets: vscode.SecretStorage, action: () => Promise<T>): Promise<T> {
  credentialUpdates.set(secrets, (credentialUpdates.get(secrets) ?? 0) + 1)
  try { return await action() }
  finally {
    const remaining = (credentialUpdates.get(secrets) ?? 1) - 1
    if (remaining) credentialUpdates.set(secrets, remaining)
    else credentialUpdates.delete(secrets)
  }
}

export async function configureApiKey(
  controller: ConfigurationController, secrets: vscode.SecretStorage, output: vscode.OutputChannel,
  provider: CredentialProvider = 'deepseek',
): Promise<void> {
  return updatingCredentials(secrets, () => configureCredential(controller, secrets, output, provider))
}

async function configureCredential(
  controller: ConfigurationController, secrets: vscode.SecretStorage, output: vscode.OutputChannel, provider: CredentialProvider,
): Promise<void> {
  if (controller.isDisposed) return
  if ((controller.runtimeOwnership === undefined && controller.state.phase !== 'loading')
    || (provider === 'opencode-go' && controller.state.phase === 'loading')) await controller.start()
  if (controller.isDisposed) return
  if (provider === 'deepseek' && controller.runtimeOwnership === 'external') {
    await vscode.window.showInformationMessage(uiText('This sidebar is using an external DeepSeek Harness runtime. Configure its API key where that process is started.', '当前连接到外部 DSH，请在启动该进程的位置配置 API Key。'))
    return
  }
  const label = provider === 'opencode-go' ? 'OpenCode Go' : 'DeepSeek'
  const secret = provider === 'opencode-go' ? OPENCODE_API_KEY_SECRET : DEEPSEEK_API_KEY_SECRET
  const normalize = provider === 'opencode-go' ? normalizeOpenCodeApiKey : normalizeDeepSeekApiKey
  const alreadyConfigured = provider === 'opencode-go' && await secrets.get(secret) !== undefined
  const target = runtimeChangeTarget(controller)
  const value = await vscode.window.showInputBox({
    title: uiText(`Configure ${label} API Key`, `配置 ${label} API Key`),
    prompt: provider === 'opencode-go'
      ? uiText('Paste your OpenCode API key. OpenCode Go and DeepSeek V4.1 Flash are configured automatically. The key is stored securely in VS Code.', '粘贴 OpenCode API Key，自动配置 Go 和 DeepSeek V4.1 Flash。Key 安全保存在 VS Code 中；能否调用将在首次请求后确认。')
      : uiText('Paste the key here. It is stored in VS Code SecretStorage and passed only to the official DSH child process.', '粘贴 DeepSeek API Key，安全保存在 VS Code 中，仅传给官方 DSH 子进程。首次请求后确认服务是否可用。'),
    placeHolder: 'sk-…', password: true, ignoreFocusOut: true,
    validateInput: candidate => {
      try { normalize(candidate); return undefined }
      catch (error) { return uiText(error instanceof Error ? error.message : String(error), '请输入纯 Key：不含空格、引号或 OPENCODE_API_KEY= 等赋值前缀。') }
    },
  })
  if (value === undefined || controller.isDisposed) return
  if (!isCurrentRuntimeTarget(controller, target)) {
    await vscode.window.showWarningMessage(uiText(`The runtime connection changed. No API key was stored; reopen Configure ${label} API Key for the intended runtime.`, `运行时连接已改变，未保存 Key。请在目标连接中重新配置 ${label}。`))
    return
  }
  await secrets.store(secret, normalize(value))
  output.appendLine(`[credentials] ${label} API key stored in VS Code SecretStorage.`)
  const selectDefault = async (): Promise<void> => {
    if (!alreadyConfigured && !controller.hasRunningTasks) await controller.selectModel(OPENCODE_DEFAULT_MODEL)
  }
  if (provider === 'opencode-go' && controller.runtimeOwnership === 'external' && isCurrentRuntimeTarget(controller, target)) {
    if (controller.state.phase !== 'ready' || controller.hasRunningTasks) {
      await vscode.window.showWarningMessage(uiText('OpenCode Go API key saved. Finish running tasks and Background Jobs, then use Start Managed Runtime to apply it.', 'OpenCode Go Key 已保存。请等任务和后台作业结束后，启动托管运行时以应用。'))
      return
    }
    // Disconnecting an external runtime leaves its process and credentials untouched.
    if (await controller.restart({ kind: 'managed' }) && !controller.isDisposed) {
      const restartedState = controller.state
      if (restartedState.phase === 'error') throw new Error(`OpenCode Go could not start: ${restartedState.statusText}`)
      if (restartedState.phase === 'ready') await selectDefault()
    }
    return
  }
  await restartAfterRuntimeChange(controller, target, uiText(`${label} API key saved; service verification follows the first request`, `${label} Key 已保存，首次请求后验证服务`), () => true,
    provider === 'opencode-go' ? selectDefault : undefined)
}

export async function clearApiKey(
  controller: ConfigurationController, secrets: vscode.SecretStorage, output: vscode.OutputChannel,
  provider: CredentialProvider = 'deepseek',
): Promise<void> {
  return updatingCredentials(secrets, () => clearCredential(controller, secrets, output, provider))
}

async function clearCredential(
  controller: ConfigurationController, secrets: vscode.SecretStorage, output: vscode.OutputChannel, provider: CredentialProvider,
): Promise<void> {
  if (controller.isDisposed) return
  const target = runtimeChangeTarget(controller)
  const label = provider === 'opencode-go' ? 'OpenCode Go' : 'DeepSeek'
  const secret = provider === 'opencode-go' ? OPENCODE_API_KEY_SECRET : DEEPSEEK_API_KEY_SECRET
  const choice = await vscode.window.showWarningMessage(
    uiText(`Remove the ${label} API key stored by this extension?`, `删除此插件保存的 ${label} API Key？`), { modal: true }, uiText('Remove', '删除'),
  )
  if (choice !== uiText('Remove', '删除') || controller.isDisposed) return
  await secrets.delete(secret)
  output.appendLine(`[credentials] ${label} API key removed from VS Code SecretStorage.`)
  if (controller.isDisposed) return
  if (isCurrentRuntimeTarget(controller, target) && controller.runtimeOwnership === 'external') {
    await vscode.window.showInformationMessage(uiText(`Stored ${label} API key removed. The reused external DSH keeps its own credentials.`, `已删除保存的 ${label} Key。外部 DSH 仍使用自身的凭据。`))
    return
  }
  await restartAfterRuntimeChange(controller, target, uiText(`Stored ${label} API key removed`, `已删除保存的 ${label} Key`))
}

interface CredentialSyncController extends RuntimeChangeController {
  readonly onDidChangeState: vscode.Event<unknown>
  credentialApplied(name: string, value: string | undefined): boolean
  setCredentialPending(value: boolean): void
}

/** Other windows may update SecretStorage while this process still holds an old key. */
export function watchCredentialChanges(
  controller: CredentialSyncController, secrets: vscode.SecretStorage, output: vscode.OutputChannel,
): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false, pending = false, checking = false, notified = false
  let revision = 0
  const schedule = (): void => {
    if (disposed || !pending) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void check() }, 250)
  }
  const check = async (): Promise<void> => {
    if (disposed || checking || controller.isDisposed) return
    if (credentialUpdates.has(secrets)) { schedule(); return }
    checking = true
    const currentRevision = revision
    const target = runtimeChangeTarget(controller)
    try {
      const keys = [DEEPSEEK_API_KEY_SECRET, OPENCODE_API_KEY_SECRET]
      const values = await Promise.all(keys.map(key => secrets.get(key)))
      if (disposed || currentRevision !== revision || !isCurrentRuntimeTarget(controller, target)) return
      if (controller.runtimeOwnership === 'external' || keys.every((key, index) => controller.credentialApplied(key, values[index]))) {
        pending = false; controller.setCredentialPending(false); return
      }
      pending = true; controller.setCredentialPending(true)
      if (controller.state.phase !== 'ready' || controller.runtimeOwnership !== 'managed') return
      if (controller.hasRunningTasks) {
        if (!notified) {
          notified = true
          void vscode.window.showInformationMessage(uiText('Credentials changed in another window. They will be applied automatically after all tasks and Background Jobs finish.', '凭据已在其它窗口更新，将在当前任务和后台作业结束后自动应用。'))
        }
        return
      }
      await restartAfterRuntimeChange(controller, target, uiText('Credential changes applied', '凭据更新已应用'))
      schedule()
    } catch {
      output.appendLine('[credentials] Could not apply credential changes; restart the runtime to retry.')
    } finally { checking = false; if (currentRevision !== revision) schedule() }
  }
  const secretChange = secrets.onDidChange(event => {
    if (event.key !== DEEPSEEK_API_KEY_SECRET && event.key !== OPENCODE_API_KEY_SECRET) return
    revision++; notified = false; pending = true; schedule()
  })
  const stateChange = controller.onDidChangeState(() => { if (pending) schedule() })
  return { dispose: () => { disposed = true; if (timer !== undefined) clearTimeout(timer); secretChange.dispose(); stateChange.dispose() } }
}

export function watchDebugConfiguration(
  controller: RuntimeChangeController, workspace: vscode.Uri, output: vscode.OutputChannel,
): vscode.Disposable {
  let timer: NodeJS.Timeout | undefined
  let revision = 0
  let disposed = false
  const listener = vscode.workspace.onDidChangeConfiguration(event => {
    const resource = controller.cwd === '' ? workspace : vscode.Uri.file(controller.cwd)
    if (!event.affectsConfiguration('deepseekHarness.autonomousDebugging', resource)) return
    const enabled = vscode.workspace.getConfiguration('deepseekHarness', resource).get<boolean>('autonomousDebugging', false)
    const target = runtimeChangeTarget(controller)
    const request = ++revision
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || controller.isDisposed || request !== revision) return
      const message = `VS Code debugging ${enabled ? 'enabled' : 'disabled'}`
      output.appendLine(`[debug] ${message}; checking whether DSH can restart to apply the setting.`)
      if (target.identity === undefined && isCurrentRuntimeTarget(controller, target)) {
        void vscode.window.showInformationMessage(`${message}. The setting will apply the next time a managed DSH runtime starts.`)
        return
      }
      if (isCurrentRuntimeTarget(controller, target) && controller.runtimeOwnership === 'external') {
        void vscode.window.showInformationMessage(`${message}. VS Code debugging integration applies to managed DSH runtimes; the connected external runtime was not changed.`)
        return
      }
      void restartAfterRuntimeChange(controller, target, message, () => !disposed && request === revision).catch(error => {
        if (disposed || controller.isDisposed || request !== revision) return
        const detail = error instanceof Error ? error.message : String(error)
        output.appendLine(`[debug] Could not apply the setting: ${detail}`)
        void vscode.window.showErrorMessage(detail)
      })
    }, 200)
  })
  return { dispose: () => { disposed = true; ++revision; if (timer !== undefined) clearTimeout(timer); listener.dispose() } }
}
