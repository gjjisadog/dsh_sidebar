import * as vscode from 'vscode'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkbenchStore, recordKey } from './workbench-store.js'
import { resolveDshHome } from './plugin-profile.js'
import { HistoryReader } from './history-reader.js'
import { ConversationProjector, type ConversationMessage } from './conversation.js'
import type { DshConnection } from './dsh-connection.js'
import type { HistoryEntry, SessionSummary } from './dsh-client.js'
import { mergeHistoryEntries } from './history.js'
import { sessionTitle } from './session-center.js'

export type PresentationMode = 'sidebar' | 'client'
interface Project { recordType: 'project'; id: string; uri: string; name: string; cwd: string; updatedAt: number }
interface Source { recordType: 'source'; id: string; root: string }
export interface CatalogSession { recordType: 'session'; sourceId: string; sessionId: string; projectId: string; cwd: string; title: string; updatedAt: number; archived: boolean }
interface CachedHistory { recordType: 'history'; sourceId: string; sessionId: string; events?: HistoryEntry[]; messages?: ConversationMessage[]; hasMore: boolean; throughSeq: number; updatedAt: number }
interface Draft { text: string; revision: number; images: unknown[] }
interface Resume { createdAt: number; project: Project; session: CatalogSession; consumed: boolean }
export interface SurfaceWorkbench {
  mode: PresentationMode
  active(): boolean
  images: Map<string, any[]>
  handle(value: Record<string, unknown>, webview: vscode.Webview): Promise<boolean>
  saveImages(sessionId: string): Promise<void>
  restore(sessionId: string, webview: vscode.Webview): Promise<void>
  initialize(webview: vscode.Webview): Promise<void>
  failed(sessionId: string, text: string): Promise<void>
  beginSend(sessionId: string): boolean
  endSend(sessionId: string): Promise<void>
  authorize(sessionId: string): Promise<void>
  sent(sessionId: string, text: string): Promise<void>
}
interface Controller {
  readonly cwd: string
  readonly archivedHistoryIds?: ReadonlySet<string>
  readonly state: { sessionId: string; messages: ConversationMessage[]; hasMoreHistory: boolean }
  start(): Promise<void>
  selectSession(id: string): Promise<void>
}

export class Workbench {
  readonly store: WorkbenchStore
  mode: PresentationMode = 'sidebar'
  readonly images = new Map<string, any[]>()
  private source: Source | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private readonly sending = new Set<string>()
  private readonly views = new Map<PresentationMode, vscode.Webview>()
  private readonly attachments = new Set<string>()
  private readonly drafts = new Map<string, Draft>()
  private draftTail: Promise<unknown> = Promise.resolve()
  private boundConnection: DshConnection | undefined
  private readonly pages = new Map<string, CachedHistory>()
  private switchMode: (mode: PresentationMode) => Promise<void> = async () => {}
  constructor(private readonly context: vscode.ExtensionContext, private readonly controller: Controller,
    private readonly connection: () => DshConnection | undefined, private readonly managed: () => boolean) {
    this.store = new WorkbenchStore(join(context.globalStorageUri.fsPath, 'history-v1'))
  }
  bindSwitch(change: (mode: PresentationMode) => Promise<void>): void { this.switchMode = change }
  async project(cwd: string, activity?: number): Promise<Project> {
    const resolved = await realpath(cwd).catch(() => cwd)
    const uri = vscode.Uri.file(resolved).toString()
    const id = recordKey(uri)
    return this.store.edit<Project>('project:' + id, previous => ({ recordType: 'project', id, uri, cwd: resolved,
      name: resolved.split(/[\\/]/).pop() || resolved, updatedAt: Math.max(previous?.updatedAt ?? 0, activity ?? previous?.updatedAt ?? Date.now()) }))
  }
  async sourceForConnection(): Promise<Source | undefined> {
    const connection = this.connection()
    if (this.boundConnection && connection !== this.boundConnection) { this.source = undefined; this.images.clear() }
    this.boundConnection = connection
    if (this.source) return this.source
    if (!this.connection()) return undefined
    const configuration = vscode.workspace.getConfiguration('deepseekHarness')
    const custom = configuration.inspect('arguments')
    if (this.managed() && custom?.globalValue === undefined && custom?.workspaceValue === undefined && custom?.workspaceFolderValue === undefined) {
      const root = await realpath(join(resolveDshHome(), 'sessions')).catch(() => join(resolveDshHome(), 'sessions'))
      this.source = await this.store.edit<Source>('source:' + recordKey(root), previous => previous ?? { recordType: 'source', id: recordKey(root), root })
    }
    return this.source
  }
  invalidateSource(): void { this.source = undefined }
  private draftKey(sessionId: string): string {
    if (!this.source) throw new Error('Associate this DSH source with its persistence directory before saving drafts.')
    return this.source.id + ':' + sessionId
  }
  private async draft(sessionId: string): Promise<Draft> {
    const key = this.draftKey(sessionId)
    await this.store.claimDraft(key)
    let draft = this.drafts.get(key)
    if (!draft) {
      draft = await this.store.read<Draft>('draft:' + key) ?? { text: '', revision: 0, images: [] }
      draft.images = await Promise.all(draft.images.map(async (image: any) => image.blob ? { ...image, data: await this.store.read<string>('attachment:' + image.blob) } : image))
      this.drafts.set(key, draft)
      this.images.set(sessionId, draft.images)
    }
    if (!this.images.has(sessionId)) this.images.set(sessionId, draft.images)
    return draft
  }
  private saveDraft(sessionId: string, text?: string): Promise<void> {
    const task = this.draftTail.catch(() => {}).then(async () => {
      if (!await this.sourceForConnection()) return
      const draft = await this.draft(sessionId)
      if (text !== undefined) draft.text = text
      draft.images = this.images.get(sessionId) ?? []
      draft.revision++
      const images = await Promise.all(draft.images.map(async (image: any) => {
        if (typeof image.data !== 'string') return image
        const blob = recordKey(image.data)
        if (!this.attachments.has(blob)) { await this.store.edit('attachment:' + blob, old => old ?? image.data); this.attachments.add(blob) }
        const { data: _data, ...metadata } = image
        return { ...metadata, blob }
      }))
      await this.store.edit('draft:' + this.draftKey(sessionId), () => ({ ...draft, images }))
    })
    this.draftTail = task
    return task
  }
  surface(mode: PresentationMode): SurfaceWorkbench {
    return {
      initialize: async webview => { await webview.postMessage({ type: 'workbench-view', view: this.context.workspaceState.get('deepseekHarness.view.' + mode, {}) }) },
      failed: async (sessionId, text) => {
        if (!await this.sourceForConnection()) return
        const draft = await this.draft(sessionId)
        if (draft.text !== text && draft.text.trim() !== text) await this.saveDraft(sessionId, text + (draft.text ? '\n\n' + draft.text : ''))
      },
      mode, active: () => this.mode === mode, images: this.images,
      handle: (value, webview) => this.handle(value, webview),
      saveImages: sessionId => this.saveDraft(sessionId),
      restore: async (sessionId, webview) => {
        this.views.set(mode, webview)
        if (!sessionId || !await this.sourceForConnection()) return
        try {
          const draft = await this.draft(sessionId)
          await webview.postMessage({ type: 'workbench-draft', sessionId, text: draft.text, images: draft.images, pending: this.sending.has(sessionId) })
        } catch {
          await webview.postMessage({ type: 'workbench-locked', sessionId })
        }
      },
      beginSend: sessionId => { if (this.sending.has(sessionId)) return false; this.sending.add(sessionId); return true },
      endSend: async sessionId => {
        this.sending.delete(sessionId)
        const view = this.views.get(this.mode)
        if (view && this.controller.state.sessionId === sessionId) await this.surface(this.mode).restore(sessionId, view)
      },
      authorize: async sessionId => { if (await this.sourceForConnection()) await this.draft(sessionId) },
      sent: async (sessionId, text) => {
        if (!await this.sourceForConnection()) return
        await this.draftTail
        const draft = await this.draft(sessionId)
        if (draft.text === text || draft.text.trim() === text) draft.text = ''
        await this.saveDraft(sessionId)
      },
    }
  }
  async catalog(): Promise<{ projects: Project[]; sessions: CatalogSession[] }> {
    const source = await this.sourceForConnection(), connection = this.connection()
    if (source && connection) {
      try {
        const { items } = await connection.call<{ items: SessionSummary[] }>('session/list', { _request: {} })
        for (const item of items) {
          if (!item.cwd || item.origin === 'subagent' || item.blank) continue
          const project = await this.project(item.cwd, item.updatedAt)
          const row: CatalogSession = { recordType: 'session', sourceId: source.id, sessionId: item.sessionId,
            projectId: project.id, cwd: item.cwd, title: sessionTitle(item), updatedAt: item.updatedAt, archived: this.controller.archivedHistoryIds?.has(item.sessionId) ?? false }
          await this.store.edit('session:' + source.id + ':' + item.sessionId, () => row)
        }
      } catch { /* Keep the last catalog available offline. */ }
    }
    return { projects: (await this.store.records<Project>('project')).sort((a,b) => b.updatedAt-a.updatedAt),
      sessions: (await this.store.records<CatalogSession>('session')).sort((a,b) => b.updatedAt-a.updatedAt) }
  }
  async cacheActive(): Promise<void> {
    const id = this.controller.state.sessionId
    if (!id || !await this.sourceForConnection()) return
    const value: CachedHistory = { recordType: 'history', sourceId: this.source!.id, sessionId: id,
      messages: this.controller.state.messages.map(message => ({ ...message, streaming: false })),
      hasMore: this.controller.state.hasMoreHistory, throughSeq: -1, updatedAt: Date.now() }
    await this.store.edit<CachedHistory>('history:' + this.draftKey(id), previous => {
      const projector = new ConversationProjector()
      projector.reset(previous?.events ?? [])
      const messages = new Map((previous?.messages ?? projector.messages()).map(message => [message.id, message]))
      for (const message of value.messages ?? []) messages.set(message.id, message)
      return { ...value, messages: [...messages.values()] }
    })
  }
  async flush(): Promise<void> { await this.draftTail; await this.cacheActive() }
  private async handle(value: Record<string, unknown>, webview: vscode.Webview): Promise<boolean> {
    if (!String(value.type).startsWith('workbench-')) return false
    const id = this.controller.state.sessionId
    switch (value.type) {
      case 'workbench-view':
        if (value.view && typeof value.view === 'object') await this.context.workspaceState.update('deepseekHarness.view.' + this.mode, value.view)
        return true
      case 'workbench-draft':
        if (value.sessionId === id && typeof value.text === 'string' && await this.sourceForConnection()) await this.saveDraft(id, value.text)
        return true
      case 'workbench-mode':
        if (id && typeof value.text === 'string' && await this.sourceForConnection()) await this.saveDraft(id, value.text)
        await this.draftTail
        await this.switchMode(this.mode === 'sidebar' ? 'client' : 'sidebar')
        return true
      case 'workbench-source': {
        const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: 'Choose the actual DSH sessions persistence directory' })
        if (selected?.[0]) {
          const root = await realpath(selected[0].fsPath)
          this.source = await this.store.edit<Source>('source:' + recordKey(root), old => old ?? { recordType: 'source', id: recordKey(root), root })
          await this.context.workspaceState.update('deepseekHarness.historySourceRoot', root)
          await this.surface(this.mode).restore(id, webview)
        }
        break
      }
      case 'workbench-add-project': {
        const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false })
        if (selected?.[0]) await this.project(selected[0].fsPath)
        break
      }
      case 'workbench-catalog': break
      case 'workbench-clear-cache':
        for (const cached of await this.store.records<CachedHistory>('history')) {
          await this.store.edit('history:' + cached.sourceId + ':' + cached.sessionId, () => ({ ...cached, events: [], messages: [], hasMore: true }))
        }
        break
      case 'workbench-preview': {
        const catalog = await this.catalog()
        const session = catalog.sessions.find(row => row.sourceId === value.sourceId && row.sessionId === value.sessionId)
        if (!session) throw new Error('History is no longer in the catalog.')
        const key = session.sourceId + ':' + session.sessionId
        let cached = await this.store.read<CachedHistory>('history:' + key)
        let error = ''
        try {
          if (session.sourceId !== this.source?.id || !this.connection()) throw new Error('Source is offline; showing cached history.')
          const previous = value.older === true ? this.pages.get(key) : undefined
          const page = await new HistoryReader(this.connection()!).page(session.sessionId, previous?.events?.[0]?.event.seq, previous?.throughSeq)
          cached = { recordType: 'history', sourceId: session.sourceId, sessionId: session.sessionId,
            events: previous?.events ? mergeHistoryEntries(previous.events, page.events) : page.events,
            hasMore: page.hasMore, throughSeq: page.throughSeq, updatedAt: Date.now() }
          this.pages.set(key, cached)
          await this.store.edit('history:' + key, () => cached!)
        } catch (failure) { error = failure instanceof Error ? failure.message : 'History unavailable.' }
        const projector = new ConversationProjector()
        projector.reset(cached?.events ?? [])
        await webview.postMessage({ type: 'workbench-preview', requestId: value.requestId, session, messages: cached?.messages ?? projector.messages(),
          hasMore: cached?.hasMore ?? false, updatedAt: cached?.updatedAt, error })
        return true
      }
      case 'workbench-resume': {
        const session = (await this.catalog()).sessions.find(row => row.sourceId === value.sourceId && row.sessionId === value.sessionId)
        if (!session) throw new Error('Unknown conversation.')
        if (session.archived) throw new Error('This conversation is archived. Use the existing archive workflow before resuming.')
        if (session.cwd === this.controller.cwd && session.sourceId === this.source?.id) {
          await this.controller.selectSession(session.sessionId)
          await webview.postMessage({ type: 'workbench-live' })
        } else {
          const project = await this.project(session.cwd)
          await this.store.edit<Resume>('resume:' + project.id, old => old && !old.consumed && Date.now()-old.createdAt < 300000 ? old : { createdAt: Date.now(), project, session, consumed: false })
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.parse(project.uri), { forceNewWindow: true })
        }
        break
      }
    }
    await webview.postMessage({ type: 'workbench-catalog', ...await this.catalog() })
    return true
  }
  async initialize(): Promise<CatalogSession | undefined> {
    if (!this.controller.cwd) return undefined
    const project = await this.project(this.controller.cwd)
    const root = this.context.workspaceState.get<string>('deepseekHarness.historySourceRoot')
    if (root) this.source = await this.store.read<Source>('source:' + recordKey(root))
    let requested: CatalogSession | undefined
    await this.store.edit<Resume | undefined>('resume:' + project.id, old => {
      if (old && !old.consumed && Date.now()-old.createdAt < 300000) { requested = old.session; return { ...old, consumed: true } }
      return old
    })
    return requested
  }
  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(operation); this.tail = next; return next
  }
  async close(): Promise<void> { await this.draftTail.catch(() => {}); await this.cacheActive().catch(() => {}); await this.store.close() }
}
