import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import { injectDebugRuntimePatch } from './debug-runtime-patch.js'
import { applyRuntimeLaunchPreparation, type RuntimeLaunchContributor, type RuntimeLaunchContext, type RuntimeLaunchPreparation } from './runtime-launch.js'

/** Mount a text-only inference Remote alongside the existing managed runtime. */
export class PromptSuggestionsRuntimeContribution implements RuntimeLaunchContributor {
  constructor(private readonly context: vscode.ExtensionContext, private readonly inner: RuntimeLaunchContributor) {}

  async prepare(launch: RuntimeLaunchContext): Promise<RuntimeLaunchPreparation | undefined> {
    const inner = await this.inner.prepare(launch)
    if (!vscode.workspace.getConfiguration('deepseekHarness', vscode.Uri.file(launch.workspacePath)).get('promptSuggestions', true)) return inner
    const storage = this.context.storageUri ?? this.context.globalStorageUri
    const patch = join(storage.fsPath, `suggestions-${randomUUID()}.cordis.yml`)
    const plugin = pathToFileURL(join(this.context.extensionUri.fsPath, 'dist', 'prompt-suggestions-plugin.mjs')).href
    const dispose = async (): Promise<void> => {
      try { await inner?.dispose?.() } finally { await rm(patch, { force: true }) }
    }
    try {
      await mkdir(storage.fsPath, { recursive: true })
      await writeFile(patch, `- insert:\n    - id: vscode-prompt-suggestions\n      name: ${JSON.stringify(plugin)}\n`, { mode: 0o600, flag: 'wx' })
      return {
        ...(inner?.environment === undefined ? {} : { environment: inner.environment }),
        transformArguments: (args, version) => injectDebugRuntimePatch(applyRuntimeLaunchPreparation(args, version, inner), patch),
        dispose,
      }
    } catch (error) { await dispose(); throw error }
  }
}
