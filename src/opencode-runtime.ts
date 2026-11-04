import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type * as vscode from 'vscode'
import { normalizeOpenCodeApiKey, OPENCODE_API_KEY_SECRET } from './credentials.js'
import { applyRuntimeLaunchPreparation, type RuntimeLaunchContext, type RuntimeLaunchContributor, type RuntimeLaunchPreparation } from './runtime-launch.js'

export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go/v1'
export const OPENCODE_DEFAULT_MODEL = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } as const

/** Keep credentials out of the overlay; the native OpenCode provider supplies session headers. */
export function openCodeRuntimePatch(): string {
  return [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    `      ${OPENCODE_DEFAULT_MODEL.provider}:`,
    '        apiKeyEnv: OPENCODE_API_KEY',
    `        baseURL: ${OPENCODE_GO_BASE_URL}`,
    '        models:',
    `          - id: ${OPENCODE_DEFAULT_MODEL.model}`,
    '- id: agent-default-model',
    '  config:',
    `    provider: ${OPENCODE_DEFAULT_MODEL.provider}`,
    `    model: ${OPENCODE_DEFAULT_MODEL.model}`,
    '',
  ].join('\n')
}

function injectOpenCodePatch(args: readonly string[], patchPath: string, version: string | undefined): string[] {
  const match = /(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?(?:\+[\w.-]+)?(?:\s|$)/.exec(version ?? '')
  if (match === null || (Number(match[1]) === 0 && (Number(match[2]) < 2
    || (Number(match[2]) === 2 && Number(match[3]) === 0 && match[4] !== undefined && Number(match[4]) < 2)))) {
    throw new Error('OpenCode Go requires DeepSeek Harness 0.2.0-rc.2 or later. Update DSH, then restart the runtime.')
  }
  if (args[0] === 'web') return ['web', '--patch', patchPath, ...args.slice(1)]
  if (args[0] === '--profile' && args[1] === 'web') return ['--profile', 'web', '--patch', patchPath, ...args.slice(2)]
  throw new Error('OpenCode Go requires the DSH Web profile (`dsh web` or `dsh --profile web`).')
}

/** Overlay the saved Go credential and default model on this owned process only. */
export class OpenCodeRuntimeContribution implements RuntimeLaunchContributor {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly debug?: RuntimeLaunchContributor,
  ) {}

  async prepare(launch: RuntimeLaunchContext): Promise<RuntimeLaunchPreparation | undefined> {
    const storedKey = await this.context.secrets.get(OPENCODE_API_KEY_SECRET)
    const key = storedKey === undefined ? undefined : normalizeOpenCodeApiKey(storedKey)
    const debug = await this.debug?.prepare(launch)
    if (key === undefined) return debug

    const storage = this.context.storageUri ?? this.context.globalStorageUri
    const patchPath = join(storage.fsPath, `opencode-${randomUUID()}.cordis.yml`)
    const dispose = async (): Promise<void> => {
      try { await debug?.dispose?.() }
      finally { await rm(patchPath, { force: true }) }
    }
    try {
      await mkdir(storage.fsPath, { recursive: true })
      await writeFile(patchPath, openCodeRuntimePatch(), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      return {
        environment: { ...debug?.environment, OPENCODE_API_KEY: key },
        transformArguments: (args, version) => injectOpenCodePatch(applyRuntimeLaunchPreparation(args, version, debug), patchPath, version),
        dispose,
      }
    } catch (error) {
      await dispose()
      throw error
    }
  }
}
