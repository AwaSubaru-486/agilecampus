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

状态：捕获/读取实现及一次性仓库真实验证完成；精确 checkpoint 接续已因日志覆盖语义改为 fail closed，等待用户验收；不推送。

验证环境：Entire CLI `0.11.3`（官方 Homebrew tap/cask，MIT）、Codex CLI `0.153.4`，执行模型为 Codex CLI 默认模型。测试在 `mktemp` 建立的临时 Git 仓库完成；仓库无 remote，未复制项目 `.env`、聊天历史或登录资料，也未在 AgileCampus 仓库启用 Entire。

完成内容：

- 新增 `vscode-extension/src/adapters/session-adapter.ts` 与 `entire-adapter.ts`：提供 `inspectCapabilities`、`listSessions`、`capture`、`readCheckpoint`、`prepareResume`。
- 只接受已验证版本 Entire `0.11.3`；未知版本 fail closed。用 `execFile` 参数数组执行，不拼 shell 命令；工作目录必须是绝对路径；校验 session/checkpoint ID；剔除继承的 Git 环境变量；错误响应不回显 stderr。
- Entire session list 默认会跨 worktree；adapter 按 `worktree_path` 与当前工作区规范路径匹配，缺少路径时 fail closed；单条 capture 二次验证归属。列表和 info 中的 `last_prompt` 不进入返回对象；测试确认其他 worktree 的会话与文件名不会泄漏。
- `prepareResume` 在 checkpoint/session 元数据吻合时仍 fail closed：Entire 0.11.3 默认不覆盖已有本机会话日志，当前 adapter 无法证明已有日志停留在所选 checkpoint。强制恢复会覆盖本机日志，因此没有生成接续命令。
- 临时仓库中真实完成“Codex 修改文件 → 提交形成 checkpoint → 枚举与读取 session/checkpoint transcript → Entire resume 恢复同一 session → Codex 继续修改 → 第二个 checkpoint”的流程。
- 临时仓库的 push sessions 已关闭，status 显示 `checkpoint_push_disabled: true`；telemetry 设置关闭，命令环境也设置退出变量；没有 remote、没有 push、没有调用 `--generate`。本次没有抓包，故不把设置检查夸大为网络层零外连保证。
- Codex 显示 `trust_review_needed`。为临时测试检查 hooks 后使用了仅限测试调用的危险信任绕过参数；普通用户的 hook 审批流程仍未手工验收。不要把该绕过参数用于产品或正常开发。
- 验收修复：版本解析要求完整版本号，拒绝 `0.11.3-rc.*`；工作区状态解析 hooks review，未完成授权时将 capture 标记为 `unverified`；`nativeResume` 当前始终是 `unverified`，因为同一 session 可能在 checkpoint 后继续但没有新 checkpoint。Entire CLI 的 `--force` 会覆盖本机已有 session 日志；E03 未实现可回滚的安全备份，因此 `prepareResume` 不生成原生恢复命令。
- 原始 transcript 有可能包含完整 prompt、模型回复和工具输入输出；不写入 fixtures、不接到云端、不对其他成员展示。fixtures 使用合成 ID。

能力：临时实验在 trust bypass 条件下证明了 capture/read 和 Entire CLI 原生 session resume 命令；正常 hooks 信任流程未验证。adapter 的精确 checkpoint 原生接续目前 fail closed，因为无法安全替换本机较新的 session 日志；portable export、cross-machine resume、fork、cancel 均未验证。适配器的 `export` 能力也明确为 `unverified`。详见 [Entire CLI 真实验证记录](entire-spike.md) 与 [能力核实表](capabilities.md)。

测试结果：

```text
npm --prefix vscode-extension run check：通过
npm --prefix vscode-extension test：28 项通过
真实 Entire CLI 临时仓库集成探针：通过（捕获、读取、resume、二次 checkpoint）
git diff --check：通过
```

未完成/保留：E01 的真实 PAT 登录路径仍待用户提供自己的 PAT 验收；正常 Codex hooks 信任审批 UI 未验证；便携导出、跨设备接续、UI 集成、持久化和分享均未实现。下一单按施工计划为 E04（Git 状态与本地检查点），本单先停在验收点。

## E04（Git 状态与本地检查点）

工单 ID / 状态：E04 / 代码完成，纳入用户授权的整批验收；不推送。

起点 HEAD：`57de40f`。在 E04 前已单独提交 E03 能力查询修正 `nativeResume: unverified`，并同步更新计划顶部的现状和 E03R 精确恢复前置门。

改动文件：扩展新增 `src/git/repository-service.ts`、`src/checkpoints/{types,schema,store}.ts`、`src/commands/{checkpoint-support,save-checkpoint,list-checkpoints}.ts`、检查点与 Git 临时仓库测试、扩展第三方声明；更新 `extension.ts`、`package.json`、README、E03 能力表和专项计划。

新增依赖：`simple-git@4.0.2`，MIT；精确锁入扩展 package/lockfile。官方项目目前 v4 使用具名 `simpleGit` 导出；v4 发布说明和 legacy Node 文档见 [simple-git repository](https://github.com/steveukx/git-js) 与 [legacy Node notes](https://github.com/steveukx/git-js/blob/main/docs/LEGACY_NODE_VERSIONS.md)。

自动测试：`npm --prefix vscode-extension run check` 退出码 0；`npm --prefix vscode-extension test` 退出码 0（40 项）；`git diff --check` 通过。Git 测试运行于一次性临时仓库，不访问 remote。

真实 VS Code / Agent / 跨机器验证：VS Code Extension Host UI 未手工操作；Entire CLI transcript 接入保持既有 E03 实验结果；跨设备未验证。

证明材料：`vscode-extension/tests/checkpoint-store.test.ts`、`repository-service.test.ts`；提交待本单完成后登记。

已知限制：附件原文需逐次确认，限制单附件 5 MiB、总量 10 MiB；会话附件作为 context-only，不代表原生恢复；Git LFS/submodule 标记恢复限制；没有代码 checkout/recovery；ignored 文件不属于 Git dirty 检查；清单只在本机 globalStorage，不会同步给队友。

下一单：E05 人工 JSON 导出/导入（当前进行中）。

本单交付点：本地检查点保存与查看命令、存储/完整性验证已实现。按用户授权继续 E05，最终统一验收。

## E05（人工导出与导入）

工单 ID / 状态：E05 / 代码完成，纳入用户授权的整批验收；不推送。

起点 HEAD：`cfa679d`。

改动文件：新增 `src/checkpoints/share-package.ts`、`src/commands/{export-checkpoint,import-checkpoint}.ts`；扩展命令注册、README、capabilities 和专项进度。

新增依赖：无。

自动测试：`npm --prefix vscode-extension run check` 退出码 0；`npm --prefix vscode-extension test` 退出码 0（45 项）；`git diff --check` 通过。

真实 VS Code / Agent / 跨机器验证：Extension Host 文件选择器、预览和两个扩展实例尚未手工验收；未调用 Agent；跨机器未验证。

证明材料：`vscode-extension/tests/share-package.test.ts` 覆盖 JSON round-trip、context-only 与 transcript 包、损坏 hash、路径逃逸、重复 ID、大小限制和明显凭据模式。

已知限制：SHA-256 只校验内容，不能认证发送人；导入的项目/任务 ID 是声明，只有在线 GET 校验通过时显示该次任务归属已核对；即便通过也不授予执行/发布权限。导出只用用户选定的本地路径，不上传云端。

下一单：E06 接续前检查。

本单交付点：本机可导出/导入经验证的 JSON 包；按用户授权继续 E06，最终统一验收。
