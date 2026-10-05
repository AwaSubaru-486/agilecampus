# 会话采集能力基线

日期：2026-10-02。工作区：`/Users/qwsdjivc/agilecampus-ai`。Git 分支：`feat/risk-aware-closure`。HEAD：`c1b53cf7717ced0036af70c37c81680ea95b2722`。

## 本机探测

| 工具 | 本机版本/结果 | 对项目的意义 |
| --- | --- | --- |
| Codex CLI | `codex-cli 0.153.4`；CLI 有 Hooks 文档和插件加载入口 | 可用官方 lifecycle hooks 捕获事件。`codex exec --json` 只适用于 AgileCampus 自己启动的 Codex CLI 进程，不等于能够监听已打开的任意 Codex 对话。 |
| Claude Code | `2.1.185`；CLI 支持 Hook/插件相关选项、`--resume` 与 `stream-json` | 有官方事件 Hook，可做独立 Claude Adapter。是否涵盖所需事件要按这个版本用 Extension Host 实测。 |
| Entire CLI | `0.11.3`；在当前 repo 中 `entire status --json` 返回 `enabled:false`、`error:"not set up"` | 仓库现有 EntireAdapter 在本工作区无法自动发现会话。不得把其现有测试或代码写成已接通。也不能默认将 Entire 作为通用数据库。 |
| VS Code 扩展 | `vscode-extension/package.json` 要求 VS Code `>=1.95.0` | 具体 Extension Host 版本、Hook 插件安装和信任流程尚未验证。 |

仅执行了版本、CLI help 和当前仓库 Entire status 检查。没有枚举/读取任何真实 Codex 或 Claude 会话，没有安装或信任 Hook，没有调用摘要模型，没有连接 GitHub 记忆仓库。

## 可用事件来源与限制

- Codex 官方 Hooks 的命令 handler 从 stdin 收到 JSON，可包含 `session_id`、`transcript_path`、`cwd`、`hook_event_name`、`model`；`UserPromptSubmit` 含 prompt，`Stop` 可含 `last_assistant_message`，工具事件可取得工具输入/输出。Hook 由本地配置或已启用插件加载；非受管 Hook 必须先由用户查看和信任。Hook 执行范围与权限要按本机版本验证。
- Codex 官方明确指出 `transcript_path` 方便访问会话 transcript，但 transcript 格式不是 Hook 的稳定接口。适配器优先保存结构化 Hook payload；解析本地 transcript 只能作为显式版本化 fallback。
- Claude Code 官方 Hooks 也会提供 `session_id`、`transcript_path`、`cwd` 等公共字段，并有 `UserPromptSubmit`、`PostToolUse`、`Stop`、`PreCompact`、`PostCompact`、`SessionEnd` 等事件。Hook 只处理当前绑定会话，不能据此递归扫描 `~/.claude`。
- 两家 transcript 路径均可能是本地敏感对话。Hook handler 只向扩展本地接收器写事件，不把对话发 HTTP，不同步摘要，不改写 Agent 提示，不阻塞工具调用。
- Hook 注册首次需要用户安装和信任。AgileCampus 可以提供明确的安装/修复指引，但不能悄悄写入或覆盖用户全局 Hooks 配置。

## 结构化映射样例

以下仅说明标准化方向，不是从用户实际会话读出的数据，也不代表 Hook 已在 Extension Host 运行。

| 合成 Hook 字段 | `NormalizedEventV1` 字段 | 映射规则 |
| --- | --- | --- |
| `session_id` + 会话开始时间 | `sessionKey` / event `id` | 原始 session ID 只留本机；平台生成不透明 sessionKey。 |
| `cwd` | workspace 绑定 | realpath 后必须等于当前已绑定仓库或允许的注册 worktree；事件内容不发送绝对路径。 |
| `UserPromptSubmit.prompt` | `kind:"user"`, `text` | 原始文本本地暂存；发布前脱敏，且只打包用户选择分享的会话区间。 |
| `PostToolUse.tool_name` 与 `tool_input` | `kind:"tool_call"` | 过滤敏感键，命令/参数保留为证据文本，不执行。 |
| `PostToolUse` 的返回/工具结果字段 | `kind:"tool_result"` | 退出码只有来源明确提供时才记数值；未提供写 null。 |
| `Stop.last_assistant_message` / Claude stop payload | `kind:"assistant"` | 作为本轮最终回复候选；若事件没有给文本，标记 gap，不能靠空字符串补齐。 |
| `PreCompact` / `PostCompact` / `SessionEnd` | `kind:"gap"` 或事件元数据 | 只记录会话边界与需要刷新来源的状态，不冒充对话正文。 |

## 主要风险及处置

1. Codex/Claude CLI 和聊天界面不是同一个采集能力。先验证各自 Hook，在没有 Hook 的界面不显示“正在记录”。
2. Stop hook 可能在交互期间多次触发；需要按稳定 event ID/turn ID 幂等写入，且不可因文本相同去重。
3. Hook stdin 可能包含密钥、文件内容或私人对话；日志默认只记脱敏错误码、事件类型和计数，不写原始 payload。
4. 扩展未运行或 hook 被拒绝时可能丢事件；必须在会话视图显示最后采集时间和 gap。transcript fallback 需明确版本支持，不可静默填补。
5. Hook 所在环境与 VS Code 扩展 Host 需要验证本地接收通道。使用限定到本机 loopback 的随机端口/IPC，校验 workspace/session 绑定，避免接收来自网络的伪事件。

## 官方参考

- [Codex Hooks 文档](https://learn.chatgpt.com/docs/hooks)：生命周期事件、Hook 输入字段、用户提示事件、信任流程、transcript_path 格式稳定性。
- [Codex 官方 Hook 输入 schema（openai/codex）](https://github.com/openai/codex/blob/main/codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json)：具体版本字段需在 M02 按目标 CLI 重新核对。
- [Codex 插件 Hook 配置](https://developers.openai.com/plugins/build/plugins)：插件 Hook 文件位置、执行环境与信任要求。
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)：事件、公共字段、输入输出和 Hook 行为。
- [Entire CLI 官方文档](https://docs.entire.io/)：用作可选会话辅助工具；本机 repo 中当前未启用。

## M00 判定

Codex 和 Claude Code 均有可实现的事件入口；本机装有两种 CLI。当前仓库仅有 Codex 经 Entire 的旧适配器，但 Entire 未启用，无法在此工作区捕获会话。采用官方事件 Hook 为主、版本化本机 transcript fallback 为辅；不直接读取供应商隐藏数据库。M02 需要真实 Host 实测后，才能把某来源改标为已验证。
