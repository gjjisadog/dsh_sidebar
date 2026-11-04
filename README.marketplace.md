# DSH Sidebar 🐋

> [!NOTE]
> ⭐ Like DSH Sidebar? [Give it a Star on GitHub](https://github.com/Lixxx1/dsh-vscode)! It helps more people find the project.
>
> GitHub: https://github.com/Lixxx1/dsh-vscode

Bring DeepSeek Harness into the place where you already write, run, and review code.

DSH Sidebar gives you a project-aware assistant in the VS Code right sidebar, with an experience familiar to Claude Code and Codex. Ask DeepSeek to inspect a repository, change files, run tools, and verify the result without leaving your editor.

<p align="center">
  <img src="media/demo.gif" alt="DeepSeek Harness working in the VS Code sidebar">
</p>

## ✨ What you can do

- **Configure OpenCode Go with one key.** Enter your OpenCode API key and start with DeepSeek V4.1 Flash; the endpoint and model are configured automatically in this development build.
- **Autonomous VS Code debugging.** Let DeepSeek launch the current project from `.vscode/launch.json`, manage breakpoints, step through execution, and inspect stack frames and local variables using VS Code's native debugger.
- **Work with the official DSH runtime.** Sessions, streaming responses, tool calls, approvals, and follow-up questions stay inside VS Code.
- **Bring in editor context.** The active file and selected code can travel with your prompt. Use `@file` or `@folder` to add more context.
- **Control each session.** Switch Permission and Plan modes, choose Model and Reasoning Effort, and steer a task while it is running.
- **Review edits natively.** Open changes in VS Code's Diff Editor, then Keep or safely Revert them. DSH stops before overwriting a file with unsaved editor changes.
- **Extend DSH from the sidebar.** Discover and manage Tools, Skills, MCP integrations, Memory, and Agent Hooks loaded by DSH.

## 📦 Before you start

DSH Sidebar runs the official DeepSeek Harness CLI on your machine. Install it first:

```sh
npm install -g @deepseek-ai/dsh
```

You need VS Code 1.100 or newer and Node.js `^22.19` or `>=24`.

## 🚀 Get started

1. Open a trusted project folder in VS Code.
2. Select **DeepSeek** in the right sidebar. If it is hidden, find it under **Other Views**.
3. Select the key button and enter your **OpenCode API key**. The default model is OpenCode Go's **DeepSeek V4.1 Flash**.
4. Choose a Permission mode, Model, and Reasoning Effort, then send your first task.

Use the Shield menu for Permission and Plan modes, `/` for official DSH commands, `@` for files and folders, and the plugins button to manage runtime extensions.

OpenCode Go requires DeepSeek Harness **0.2.0-rc.2 or newer** and an active [Go or Go Plus subscription](https://opencode.ai/v2/docs/console/go/). Keys are stored securely in VS Code. The original DeepSeek key setup is available in the Command Palette as **DeepSeek Harness: Configure DeepSeek API Key**.

### Autonomous debugging

Enable **DeepSeek Harness: Autonomous Debugging** in VS Code Settings and add a debug configuration to `.vscode/launch.json`.

DeepSeek can then start the debugger, set breakpoints, step through execution, inspect runtime values, fix the code, and verify the result directly from the sidebar.

Requires DeepSeek Harness `0.1.2-rc.1` or a compatible newer release. Tested with `0.1.5-rc.1`.

## 💬 Feedback

If something feels awkward or you have an idea for the next feature, come say hi in [GitHub Issues](https://github.com/Lixxx1/dsh-vscode/issues). PRs are welcome too!

[Website](https://lixxx1.github.io/dsh-vscode/) · [GitHub](https://github.com/Lixxx1/dsh-vscode)
