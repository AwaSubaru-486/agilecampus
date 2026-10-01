# VS Code 检查点接续施工进度

## E00–E02（第一轮）

状态：E00–E02 的验收缺陷已修复并通过回归检查；真实 PAT 登录与任务读取仍待用户验收。

施工起点：`bba2285`。施工时保留以下他人未提交改动，没有暂存或提交：`src/lib/approval.ts`、`src/lib/collaboration-console.ts`、`tests/collaboration-console.test.ts`。

环境：Node `v26.8.1`、npm `11.19.0`、VS Code `1.122.0`。扩展开发宿主已安装。

完成内容：

- E00：修正 Webview view 声明；增加 Extension Development Host F5 配置与编译任务；扩展目录有独立 `check`、`test`；刷新说明文档。Extension Development Host 的 Extension Host 日志确认 `agilecampus.agilecampus-vscode` 成功激活；当前侧栏项目入口收在 VS Code“其他视图”溢出菜单中。
- E01：用 AgileCampus PAT 读取项目；令牌按 server origin 与 workspace URI 哈希隔离并写入 VS Code SecretStorage；项目绑定放入 workspaceState；校验远程 HTTPS、禁用重定向、请求超时、401/403/服务端错误和绑定切换；读取本机 Git 插件 `RepositoryState.remotes` 的仓库名/分支，不要求 GitHub 登录。
- E02：真实列项目任务、负责人、状态、截止日和任务交接要求；详情点击后按需读取；未知消息、非 UUID 的任务引用不进入 host；固定生成带 projectId 的 work/studio 页面链接；失败状态保留上次数据及同步时间。刷新成功后失效并重读当前任务详情；项目、任务及 Git 数据请求完成后统一检查请求代次，丢弃过期响应。

测试命令和结果：

```text
npm --prefix vscode-extension run check：通过（Extension Host TS + Webview bundle）
npm --prefix vscode-extension test：18 项通过（含 Git API、项目切换竞态、详情缓存刷新、工作区令牌隔离）
git diff --check：通过
```

真实端点探测：`GET http://localhost:3000/` 跳转到 `/login`；未提供凭据调用 `GET /api/agent/projects` 返回 401。真实 PAT 的成功路径尚未验证，未读取、保存或输出用户令牌。已通过 Extension Host 日志确认扩展激活；本机真实任务读取、点击详情和网页跳转仍需用户输入自己的 PAT 后验收。

能力边界：Webview 可以查看任务并打开网页任务/Agent 会话；插件尚未采集 session、保存检查点、传递跨设备材料或恢复/启动本地 Agent。暂无任务分页，因此大项目的数据规模是已知限制。`repository` 来自 VS Code Git 扩展；未启用/不存在 Git 扩展时显示未检测到仓库。

E00–E02 验收状态：代码侧已按上一轮验收意见修正；用户随后要求进入下一项，因此开始 E03。E01 真实 PAT 成功路径仍未验收，需后续单独补验。

## E03（Entire session adapter）

状态：实现和一次性仓库真实验证完成，等待用户验收；不推送。

验证环境：Entire CLI `0.11.3`（官方 Homebrew tap/cask，MIT）、Codex CLI `0.153.4`，执行模型为 Codex CLI 默认模型。测试在 `mktemp` 建立的临时 Git 仓库完成；仓库无 remote，未复制项目 `.env`、聊天历史或登录资料，也未在 AgileCampus 仓库启用 Entire。

完成内容：

- 新增 `vscode-extension/src/adapters/session-adapter.ts` 与 `entire-adapter.ts`：提供 `inspectCapabilities`、`listSessions`、`capture`、`readCheckpoint`、`prepareResume`。
- 只接受已验证版本 Entire `0.11.3`；未知版本 fail closed。用 `execFile` 参数数组执行，不拼 shell 命令；工作目录必须是绝对路径；校验 session/checkpoint ID；剔除继承的 Git 环境变量；错误响应不回显 stderr。
- Entire session list 默认会跨 worktree；adapter 按 `worktree_path` 与当前工作区规范路径匹配，缺少路径时 fail closed；单条 capture 二次验证归属。列表和 info 中的 `last_prompt` 不进入返回对象；测试确认其他 worktree 的会话与文件名不会泄漏。
- `prepareResume` 只返回待确认的 executable/argv，不启动 Agent、不切分支。native resume 可能改变 checkout，未来执行前需要单独检查 worktree 和 dirty 状态。
- 临时仓库中真实完成“Codex 修改文件 → 提交形成 checkpoint → 枚举与读取 session/checkpoint transcript → Entire resume 恢复同一 session → Codex 继续修改 → 第二个 checkpoint”的流程。
- 临时仓库的 push sessions 已关闭，status 显示 `checkpoint_push_disabled: true`；telemetry 设置关闭，命令环境也设置退出变量；没有 remote、没有 push、没有调用 `--generate`。本次没有抓包，故不把设置检查夸大为网络层零外连保证。
- Codex 显示 `trust_review_needed`。为临时测试检查 hooks 后使用了仅限测试调用的危险信任绕过参数；普通用户的 hook 审批流程仍未手工验收。不要把该绕过参数用于产品或正常开发。
- 原始 transcript 有可能包含完整 prompt、模型回复和工具输入输出；不写入 fixtures、不接到云端、不对其他成员展示。fixtures 使用合成 ID。

能力：capture/read/native resume 在当前组合下已验证；portable export、cross-machine resume、fork、cancel 均未验证。适配器的 `export` 能力也明确为 `unverified`。详见 [Entire CLI 真实验证记录](entire-spike.md) 与 [能力核实表](capabilities.md)。

测试结果：

```text
npm --prefix vscode-extension run check：通过
npm --prefix vscode-extension test：27 项通过
真实 Entire CLI 临时仓库集成探针：通过（捕获、读取、resume、二次 checkpoint）
git diff --check：通过
```

未完成/保留：E01 的真实 PAT 登录路径仍待用户提供自己的 PAT 验收；正常 Codex hooks 信任审批 UI 未验证；便携导出、跨设备接续、UI 集成、持久化和分享均未实现。下一单按施工计划为 E04（Git 状态与本地检查点），本单先停在验收点。
