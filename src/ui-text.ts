import * as vscode from 'vscode'

export function uiText(english: string, chinese: string): string {
  return /^zh\b/i.test(vscode.env?.language ?? '') ? chinese : english
}
