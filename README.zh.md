# DeepSeek Harness for VS Code 🐋

> [!NOTE]
> ⭐ 如果觉得好用，欢迎[给项目点个 Star](https://github.com/Lixxx1/dsh-vscode)！也能让更多人看到它。

把 DeepSeek Harness 放到你真正写代码的地方。dsh-vscode 为 DSH 提供类似 Claude Code、Codex 的 VS Code 右侧边栏，并自动理解当前项目、文件和选区。

让 DeepSeek 直接阅读、修改和验证代码，不再需要在编辑器、终端和独立聊天窗口之间反复切换。

👋 我做这个插件，是因为自己也想让 DSH 一直待在编辑器旁边。如果这也是你喜欢的工作方式，欢迎试试看！也欢迎告诉我它用起来怎么样。

[English](README.md) | **简体中文** | [日本語](README.ja.md)

[项目主页](https://lixxx1.github.io/dsh-vscode/) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lixxx1.dsh-sidebar)

[![CI](https://github.com/Lixxx1/dsh-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/Lixxx1/dsh-vscode/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lixxx1.dsh-sidebar?style=flat-square&label=VS%20Code%20Marketplace&color=4d6bfe)](https://marketplace.visualstudio.com/items?itemName=lixxx1.dsh-sidebar)
[![MIT License](https://img.shields.io/badge/license-MIT-263146?style=flat-square)](LICENSE)
![Status](https://img.shields.io/badge/status-alpha-7da1de?style=flat-square)

<p align="center">
  <img src="media/demo.gif" alt="VS Code 侧边栏中的 DeepSeek Harness">
</p>

## ✨ 功能

- **OpenCode Go 开箱即用。** 点击钥匙按钮填入 OpenCode API Key，自动配置 Go 接口并默认使用 DeepSeek V4.1 Flash。
- **自主调用 VS Code 原生调试器。** DeepSeek 可以通过当前项目的 `.vscode/launch.json` 启动调试、管理断点、单步执行，并读取调用栈和局部变量。
- **在 VS Code 中使用官方 DSH。** 会话、流式回复、工具调用、审批和追问都通过官方 DSH runtime 运行。
- **自动结合编辑器上下文。** 当前文件、选中的代码以及 `@file`、`@folder` 引用会随消息一起发送。
- **随时控制运行中的任务。** 切换 Permission 和 Plan 模式，分别选择模型和推理强度，也可以在任务运行时调整方向。
- **原生改动审阅与安全回退。** 在 VS Code Diff Editor 中检查改动，执行 Keep 或 Revert；遇到未保存文件时，会在覆盖前停止任务。
- **直接在侧边栏扩展 DSH。** 查找和管理 Tools、Skills、MCP、Memory 与 Agent Hooks，并交给 DSH 加载。

## 📦 安装

先安装官方 DeepSeek Harness CLI：

```sh
npm install -g @deepseek-ai/dsh
```

然后根据需要选择扩展版本：

### 发布版

在 VS Code 中打开**扩展**，搜索 **DSH Sidebar** 并点击**安装**；也可以直接从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lixxx1.dsh-sidebar) 安装。

### 最新开发版

如果想提前使用已经合并到 `main`、但尚未发布到 Marketplace 的功能，可以构建并安装最新 VSIX：

```sh
git clone https://github.com/Lixxx1/dsh-vscode.git
cd dsh-vscode
pnpm install --frozen-lockfile
pnpm run package
```

然后在 VS Code 命令面板中运行 **Extensions: Install from VSIX...**，选择生成的 `dsh-vscode.vsix`。开发版更新更快，稳定性可能不如 Marketplace 版本；之后拉取最新代码并重新构建 VSIX 即可更新。

需要 VS Code 1.100 或更新版本，以及 Node.js `^22.19` 或 `>=24`。

安装社区 runtime 插件还需要确保 `pnpm` 已加入 PATH。

## 🚀 使用

1. 在 VS Code 中打开一个受信任的项目文件夹。
2. 在右侧选择 **DeepSeek**。如果没有显示，可以在 **其他视图** 中找到它。
3. 点击钥匙按钮填入 **OpenCode API Key**。此开发版自动使用 OpenCode Go 的 **DeepSeek V4.1 Flash**，无需填写接口地址或模型名称。
4. 选择 Permission 模式、Model 和 Reasoning Effort，然后开始工作。Shield 菜单用于切换 Permission 和 Plan 模式，输入 `/` 使用 DSH 官方命令，输入 `@` 添加文件或文件夹。
5. 点击侧边栏标题栏中的插件按钮，搜索、安装、查看或移除社区 runtime 插件。

### OpenCode Go

本次二次开发的功能包含在此目录构建的 VSIX 中，安装 `dsh-vscode.vsix` 后即可使用。需要 DeepSeek Harness **0.2.0-rc.2 或更新版本**，以及有效的 [OpenCode Go / Go Plus 订阅](https://opencode.ai/v2/docs/console/go/)。默认模型 ID 为 `deepseek-v4.1-flash`。

Key 保存在 VS Code 的安全凭据存储中，不写入项目文件或运行时配置文件。首次保存后，空闲的侧栏运行时会自动重启，并为当前对话选择默认模型；更新已有 Key 时保留当前模型。已连接外部 DSH 时，插件改为启动自己管理的实例，外部进程继续运行；如有任务或后台作业正在执行，则先保存 Key，等待任务结束后应用。

删除 Key 后，旧对话和新对话会恢复可选模型，并显示凭据配置引导。其它窗口更新凭据后，空闲的托管运行时会自动应用；有任务时显示待重启状态。

运行时选项在 VS Code 设置中搜索 **DeepSeek Harness**；API Key 通过命令面板配置，运行日志通过 **DeepSeek Harness: Show Runtime Output** 查看。

原有 DeepSeek 配置入口保留在命令面板的 **DeepSeek Harness: Configure DeepSeek API Key** 中。要删除保存的 OpenCode Key，运行 **DeepSeek Harness: Clear Stored OpenCode Go API Key**。

开发验证可运行 `node tests/dsh-runtime-smoke.mjs /path/to/dsh/lib/bin.js --opencode-go`。它启动隔离的 DSH 和本地模拟模型服务，验证默认模型、Key 认证、主对话及自动标题的会话请求头，不调用真实模型或使用用户凭据。还可运行 `node tests/opencode-lifecycle.mjs /path/to/dsh/lib/bin.js`，验证换 Key、删 Key 和重启后的恢复；CI 在 Linux、Windows、macOS 执行这两项测试。

### 下一句话建议

回复完成后，插件使用当前模型，根据最近六条用户消息和助手回复生成一句建议，显示在空输入框中。按 **Tab** 填入草稿，按 **Esc** 忽略；不会自动发送。建议请求不带工具，会额外消耗少量 Token。可在 VS Code 设置中关闭 **DeepSeek Harness: Prompt Suggestions**。开启后使用托管 DSH 运行时，启用后需重启运行时；没有安装建议插件的外部运行时不会显示建议。

### 自主调试

在 VS Code 设置中启用 **DeepSeek Harness: Autonomous Debugging**，并在 `.vscode/launch.json` 中添加调试配置。

之后，DeepSeek 就能直接从侧边栏启动调试器、设置断点、单步执行、检查运行时变量、修复代码并验证结果。

需要 DeepSeek Harness `0.1.2-rc.1` 或兼容的更新版本，已使用 `0.1.5-rc.1` 测试。

💬 如果哪里用着不顺手，或者你有想加的功能，欢迎来 [Issue](https://github.com/Lixxx1/dsh-vscode/issues) 里聊聊，也欢迎直接提 PR！

## License

[MIT](LICENSE)

### 双模式工作台与工程历史

点击 VS Code 左侧活动栏的 DSH 图标即可在主编辑区打开客户端；重复打开会聚焦已有工作台。入口中也可切换到聊天侧栏。侧栏的 ⇄ 按钮或 **DeepSeek Harness: Open Chat in Editor** 命令同样可进入客户端。客户端显示工程导航和聊天；侧栏与客户端互斥，切换不取消当前任务。关闭客户端标签页会返回侧栏。

客户端可以登记本机工程、搜索会话标题并只读预览历史；点击“在所属工程继续”才进入聊天，其他工程在新窗口打开。只读历史使用官方 projections/page 接口，旧版不支持时显示缓存和错误原因，不自动恢复旧 Agent。

默认托管来源自动登记；外部或自定义运行时请在客户端使用“关联 DSH 数据源”，选择实际的 sessions 持久化目录。目录仅用于确认来源，不直接解析或修改 DSH 日志。已查看正文和完整草稿保存在当前 VS Code 用户配置文件的扩展存储中；未缓存页及附件仍需原数据源。草稿被其他窗口持有时只读，关闭持有窗口后可重试。清理历史缓存不删除草稿或原始对话。

关闭工程窗口时托管服务停止；重开恢复界面和草稿，不自动重发任务。跨窗口定位请求五分钟后失效。隔离历史协议验证：`node tests/history-runtime.mjs /path/to/dsh/lib/bin.js`。
