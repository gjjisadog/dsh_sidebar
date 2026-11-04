import { uiText } from './ui-text.js'
import * as vscode from 'vscode'

export interface RuntimeChangeController {
  readonly cwd: string
  readonly isDisposed: boolean
  readonly runtimeOwnership: 'external' | 'managed' | undefined
  readonly runtimeIdentity: object | undefined
  readonly hasRunningTasks: boolean
  readonly state: { phase: 'loading' | 'ready' | 'error'; statusText: string }
  /** False when another connection operation superseded this restart. */
  restart(): Promise<boolean>
}

export interface RuntimeChangeTarget {
  readonly identity: object | undefined
  readonly cwd: string
}

export function runtimeChangeTarget(controller: RuntimeChangeController): RuntimeChangeTarget {
  return { identity: controller.runtimeIdentity, cwd: controller.cwd }
}

export function isCurrentRuntimeTarget(controller: RuntimeChangeController, target: RuntimeChangeTarget): boolean {
  return !controller.isDisposed && target.identity === controller.runtimeIdentity && target.cwd === controller.cwd
}

/** For automatic restarts after a saved change, not the explicit Restart command. */
export async function restartAfterRuntimeChange(
  controller: RuntimeChangeController,
  target: RuntimeChangeTarget,
  successMessage: string,
  isCurrent: () => boolean = () => true,
  onRestarted?: () => Promise<void>,
): Promise<void> {
  if (controller.isDisposed || !isCurrent()) return
  if (!isCurrentRuntimeTarget(controller, target) || controller.state.phase === 'loading'
    || (controller.runtimeOwnership !== undefined && controller.state.phase !== 'ready')) {
    await vscode.window.showWarningMessage(`${successMessage}${uiText(". The runtime connection changed; no runtime was restarted. Restart the intended runtime when ready to apply the change.", "。连接已改变，请在目标运行时就绪后重启以应用。")}`)
    return
  }
  if (controller.runtimeOwnership === 'external') {
    await vscode.window.showWarningMessage(`${successMessage}${uiText(". Restart the external DeepSeek Harness process to apply this change, then reconnect from VS Code.", "。请重启外部 DSH 进程后重新连接。")}`)
    return
  }
  if (controller.hasRunningTasks) {
    await vscode.window.showWarningMessage(`${successMessage}${uiText(". DeepSeek tasks are still running, so the runtime was not restarted. Restart it after those tasks and Background Jobs finish to apply the change.", "。任务或后台作业仍在运行，请在结束后重启以应用。")}`)
    return
  }
  // No asynchronous dialog between the last activity check and starting the restart.
  if (!await controller.restart() || controller.isDisposed || !isCurrent()) return
  if (controller.state.phase === 'error') {
    throw new Error(`${successMessage}${uiText(", but DSH could not restart: ", "，但 DSH 重启失败：")}${controller.state.statusText}`)
  }
  if (controller.state.phase === 'ready') {
    const restartedTarget = runtimeChangeTarget(controller)
    await onRestarted?.()
    if (!isCurrentRuntimeTarget(controller, restartedTarget) || !isCurrent() || controller.state.phase !== 'ready') return
    await vscode.window.showInformationMessage(`${successMessage}${uiText(". DeepSeek Harness restarted.", "。DSH 已重启。")}`)
  }
}
