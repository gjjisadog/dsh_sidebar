# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> ⭐ Like DSH Sidebar? [Give it a Star on GitHub](https://github.com/Lixxx1/dsh-vscode)! It helps more people find the project.

Bring DeepSeek Harness into the same place you write code. dsh-vscode gives DSH a Claude Code/Codex-style right sidebar that already understands your project, active file, and selected code.

Ask DeepSeek to inspect, change, and verify code without switching between your editor, terminal, and a separate chat window.

👋 I built this because I wanted DSH right beside my editor. If that sounds useful to you too, give it a try! I'd love to hear how it fits into your workflow.

**English** | [简体中文](README.zh.md) | [日本語](README.ja.md)

[Website](https://lixxx1.github.io/dsh-vscode/) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lixxx1.dsh-sidebar)

[![CI](https://github.com/Lixxx1/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/Lixxx1/dsh-vscode/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixxx1.dsh-sidebar?style=flat-square&label=VS%20Code%20Marketplace&color=4d6bfe)](https://marketplace.visualstudio.com/items?itemName=lixxx1.dsh-sidebar)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="DeepSeek Harness in the VS Code sidebar">
</p>

## ✨ Features

- **OpenCode Go with one key.** Enter your OpenCode API key to configure Go automatically and start with DeepSeek V4.1 Flash.
- **Autonomous VS Code debugging.** Let DeepSeek launch the current project from `.vscode/launch.json`, manage breakpoints, step through execution, and inspect stack frames and local variables using VS Code's native debugger.
- **Official DSH inside VS Code.** Sessions, streaming responses, tool calls, approvals, and follow-up questions run through the official DSH runtime.
- **Project-aware editor context.** The active file, selected code, and `@file` or `@folder` references travel with your prompt.
- **Session controls where you need them.** Switch Permission and Plan modes, choose Model and Reasoning Effort, or steer an active task.
- **Native review and safe revert.** Review changes in VS Code's Diff Editor, Keep or Revert edits, and stop DSH before it overwrites a file with unsaved changes.
- **Extend DSH from the sidebar.** Discover and manage Tools, Skills, MCP integrations, Memory, and Agent Hooks loaded by DSH.

## 📦 Install

Install the official DeepSeek Harness CLI:

```sh
npm install -g @deepseek-ai/dsh
```

Then choose the extension channel that fits you:

### Published release

Open **Extensions** in VS Code, search for **DSH Sidebar**, and select **Install**. You can also install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lixxx1.dsh-sidebar).

### Latest development build

To try features already available on `main` but not yet published to the Marketplace, build and install the latest VSIX:

```sh
git clone https://github.com/Lixxx1/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

In VS Code, run **Extensions: Install from VSIX...** from the Command Palette and select `dsh-vscode.vsix`. Development builds move faster and may be less stable; pull the latest changes and rebuild the VSIX to update.

Requires VS Code 1.100 or newer and Node.js `^22.19` or `>=24`.

Installing community runtime plugins also requires `pnpm` on your PATH.

## 🚀 Use

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Use the key button to enter your **OpenCode API key**. This development build automatically selects **DeepSeek V4.1 Flash** through OpenCode Go; no endpoint or model configuration is needed.
4. Choose the Permission mode, Model, and Reasoning Effort, then start working. Use the Shield menu for Permission and Plan modes, `/` for official DSH commands, and `@` to add files or folders.
5. Use the plugins button in the sidebar title to search, install, inspect, or remove community runtime plugins.

### OpenCode Go

This customization is included in the VSIX built from this checkout. Install `dsh-vscode.vsix`, use DeepSeek Harness **0.2.0-rc.2 or newer**, and have an active [OpenCode Go or Go Plus subscription](https://opencode.ai/v2/docs/console/go/). The default model ID is `deepseek-v4.1-flash`.

The key is stored in VS Code SecretStorage and kept out of project files and runtime overlays. Saving it restarts an idle managed runtime and selects the default model on first setup (key rotation preserves the current model). An idle external connection switches to an extension-managed instance without stopping the external process. Running tasks and Background Jobs defer the restart until you finish them.

The original provider remains available through **DeepSeek Harness: Configure DeepSeek API Key** in the Command Palette. Remove the stored Go key with **DeepSeek Harness: Clear Stored OpenCode Go API Key**.

For development validation, run `node tests/dsh-runtime-smoke.mjs /path/to/dsh/lib/bin.js --opencode-go`. It uses an isolated real DSH and a loopback model fixture to verify the default model, API-key authentication, and session headers on both agent and automatic-title requests. It makes no real model requests and uses no user credentials.

### Next-message suggestions

After a reply finishes, the selected model can suggest your next message as gray text in the empty composer. **Tab** fills the draft; **Escape** dismisses it. Suggestions never send automatically. This uses a small extra model request with the last six user/assistant messages and no tools. Disable **DeepSeek Harness: Prompt Suggestions** in VS Code Settings to opt out. Enabling it uses a managed DSH runtime; restart the runtime after enabling. External runtimes without the suggestion plugin simply show no suggestion.

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Requires DeepSeek Harness `0.1.2-rc.1` or a compatible newer release. Tested with `0.1.5-rc.1`.

💬 Found a rough edge or have an idea for what should come next? [Open an issue](https://github.com/Lixxx1/dsh-vscode/issues). I read every piece of feedback, and contributions are welcome too.

## License

[MIT](LICENSE)
