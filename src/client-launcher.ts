import * as vscode from 'vscode'

export function registerClientLauncher(context: vscode.ExtensionContext, openClient: () => Promise<void>): void {
  const open = new vscode.TreeItem('打开 DSH 工作台')
  open.iconPath = new vscode.ThemeIcon('open-preview')
  open.command = { command: 'deepseekHarness.openInEditor', title: '打开 DSH 工作台' }
  const sidebar = new vscode.TreeItem('切换到聊天侧栏')
  sidebar.iconPath = new vscode.ThemeIcon('layout-sidebar-right')
  sidebar.command = { command: 'deepseekHarness.openChat', title: '切换到聊天侧栏' }
  const launcher = vscode.window.createTreeView('deepseekHarness.clientLauncher', {
    treeDataProvider: { getTreeItem: item => item, getChildren: () => [open, sidebar] },
  })
  const reveal = (): void => {
    void openClient().catch(error => { void vscode.window.showErrorMessage(String(error)) })
  }
  context.subscriptions.push(launcher, launcher.onDidChangeVisibility(event => { if (event.visible) reveal() }))
  if (launcher.visible) reveal()
}
