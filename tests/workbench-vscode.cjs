// Native extension-host acceptance test; use an isolated --user-data-dir and workspace.
const assert = require('node:assert/strict')
const vscode = require('vscode')
exports.run = async () => {
  await vscode.extensions.getExtension('lixxx1.dsh-sidebar').activate()
  const clients = () => vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab=>tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('deepseekHarness.editor'))
  await vscode.commands.executeCommand('deepseekHarness.openInEditor')
  assert.equal(clients().length,1)
  await vscode.commands.executeCommand('deepseekHarness.openInEditor')
  assert.equal(clients().length,1,'reopening reuses one client')
  await vscode.commands.executeCommand('deepseekHarness.openChat')
  assert.equal(clients().length,0,'sidebar mode closes client')
  await Promise.all([vscode.commands.executeCommand('deepseekHarness.openInEditor'),vscode.commands.executeCommand('deepseekHarness.openChat'),vscode.commands.executeCommand('deepseekHarness.openInEditor')])
  assert.equal(clients().length,1,'rapid transitions end with one client')
  await vscode.window.tabGroups.close(clients())
  await new Promise(resolve=>setTimeout(resolve,200))
  assert.equal(clients().length,0,'closing client returns to sidebar without recreating it')
  console.log('Native VS Code mode transitions passed.')
}
