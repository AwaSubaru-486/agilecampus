# 能力盘点（代码核对 + 本次运行）

被测来源：HEAD c1b53cf7717ced0036af70c37c81680ea95b2722，另含用户未提交的 agent-run rail UI 改动。网页服务由隔离副本运行。

| 能力 | 网页 / VS Code 入口 | 实际调用 / 存储 | 本次状态 |
| --- | --- | --- | --- |
| 网页 AI 助手 | 项目工作区聊天面板 | POST /api/chat → runAgentTurn → getModel()；读取 DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL。当前模型默认值 deepseek-v4-flash。 | 配置在测试副本留空；真实调用 BLOCKED。 |
| AI 项目工具 | 聊天面板 → 草案卡片 / 确认 | 任务和项目工具生成草案，经 /api/chat/commit 或 approval API 人工确认后写业务数据。 | 真实模型链未验证。 |
| 插件项目 / 任务读取 | agilecampus.connect、selectProject、openTask | 扩展 client 读取 /api/agent/projects、/api/agent/tasks/*；PAT 使用 VS Code SecretStorage。 | 源码确认；Extension Host UI 未验证。 |
| 插件执行 Agent | agilecampus.resumeCheckpoint | process-runner.ts 启动 codex exec --json --sandbox workspace-write，要求 Codex CLI 0.153.4；命令没有为 DeepSeek 设置 provider。 | 扩展内 DeepSeek 路径未接线/未验证；没有启动 Agent。 |
| 保存检查点 | agilecampus.saveCheckpoint | 拉取项目任务与任务详情；摘要、Git SHA、可选 Entire transcript 存在扩展 globalStorage。此命令没有调用 checkpoint 创建 API。 | 源码确认、本次 Extension Host 未验证。 |
| 导出 / 导入 | exportCheckpoint / importCheckpoint | 本机 JSON 包；人工传递文件；导入后校验哈希并读取当前平台任务。 | 代码单测通过；真实双账号 UI 流程未验证。 |
| 服务端检查点 / 交接 / Attempt | /api/extension/v1/** | 后端路由与领域逻辑存在；需要 Bearer PAT 和真实任务/版本。 | Build 包含这些路由；未在真实 HTTP 上走授权写路径。 |
| 扩展共享交接 | 未发现对应 UI / API client 方法 | vscode-extension/src/agilecampus/api-client.ts 当前只含 agent project/task GET；扩展源码没有 /api/extension/v1 请求。 | BLOCKED：共享 API 存在但未接到扩展。 |
| 并行工作区 | agilecampus.forkAttempt / compareAttempts | 本地 Git worktree、globalStorage Attempt receipts；不自动选择或合并。 | 代码单测通过；Extension Host 与真实 Agent 并行未验证。 |
| 人工验收 | 网页任务正常提交 / 审核流程 | Task / handoff 领域状态机。 | AI 创建任务、插件 Attempt 回传和人工验收整链未验证。 |

边界：网页 DeepSeek 环境配置不会自动配置插件里的本地 Codex CLI；本机检查点、文件导入和服务器交接索引也不是同一种存储。真实 session transcript 只在 Entire capture 可用且用户确认时附加；仅结构化摘要时属于 context-only。
