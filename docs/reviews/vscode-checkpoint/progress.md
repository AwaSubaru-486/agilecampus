# VS Code 检查点接续施工进度

## 2026-10-01 代码复核补修

复核结论：E07/E08/E10 的代码验收暂缓。此前审查发现 VSIX 未带入 `simple-git`、工作目录锁只在单个 Extension Host 生效、多窗口会误标活动进程、worktree 允许嵌套、Attempt 缺少完成回执等问题。本工作树已实现补修：宿主入口改为 esbuild 打包；按真实 workdir 规范路径使用本机文件租约并记录 Extension Host/Agent PID；只在进程不可见时转 `unknown`，增加人工确认结束入口；拒绝与已登记 worktree 路径重叠；保存 Agent 最终消息、完成时 HEAD/dirty 状态，并允许用户手工登记测试命令和结果。

本轮核验：`npm --prefix vscode-extension run check` 通过；`git diff --check` 通过。未运行测试、未重新打 VSIX，也未在 VS Code Extension Host 或双窗口实测。因此这些修复目前是编译通过的实现，不能写成回归测试或安装包验收通过。未推送、未发布。已有其他负责人未提交的网页端改动保持原样。

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

下一单：E06 接续前检查（本次完成）。

本单交付点：本机可导出/导入经验证的 JSON 包；按用户授权继续 E06，最终统一验收。

## E06（接续前检查与接续材料）

工单 ID / 状态：E06 / 自动检查通过，纳入用户授权的整批验收；Extension Host 手工操作待最终验收；不推送。

起点 HEAD：`c1774fe`。

改动文件：扩展检查点 schema、Git 服务、任务快照、接续 preflight/plan/命令注册和测试；扩展 README、命令面板与侧栏标题菜单；更新本进度和能力表。

新增依赖：无。

实现：E06 通过后只生成 Markdown 计划，不启动 Agent。启动条件检查工作区信任、当前 token 是否能读取任务、项目/任务 ID、任务是否已完成、任务字段和契约版本差异、仓库 remote/local identity、检查点 SHA 是否存在、HEAD 完全匹配、目录是否 dirty、Git LFS/submodule 限制；`CheckpointStore.read` 同时核验全部附件哈希/长度。任务变化逐字段展示并要求用户确认后，计划使用当前服务端版本；任务关闭、权限失效或代码目录不匹配则阻止。

计划明确写出 SHA、目标目录、context-only 模式、附件类型与字节数、任务要求的验收证据和本地 workspace-write 权限边界。已有 schemaVersion 1 检查点若缺少本次新补充的 dueDate 仍可读取；该字段按 null 比较并在任务要求不同后要求人工确认。未知 Agent 来源版本不会被用于原生恢复，仅作为用户选择的附件材料并显示警告。

自动测试：`npm --prefix vscode-extension run check` 退出码 0；`npm --prefix vscode-extension test` 退出码 0（当前 53 项）；`git diff --check` 通过。

真实 VS Code / Agent / 跨机器验证：本单未在 Extension Development Host 点击命令；没有启动 Agent；跨机器未验证。

证明材料：`vscode-extension/tests/handoff-preflight.test.ts` 覆盖任务变化、改派、已完成、权限/信任、仓库不符、缺 SHA、dirty、LFS/submodule、未知 adapter 版本；`checkpoint-store.test.ts` 覆盖早期 schemaVersion 1 数据兼容。

下一单：E07 已完成。Codex CLI 本机为 `0.153.4`；Entire 原生恢复仍 unsupported，不会使用 `--force` 或覆盖 session 日志。

## E07（新建会话并记录真实回执）

工单 ID / 状态：E07 / 代码和一次性仓库 Agent 冒烟完成，纳入用户授权的整批验收；Extension Host UI 启动路径待最终验收；不推送。

起点 HEAD：`f8d0af1`。

改动文件：新增扩展 `src/adapters/process-runner.ts`、`src/handoff/launch.ts`、`src/attempts/store.ts`、`src/commands/resume-checkpoint.ts` 及测试；更新命令注册、package command/activation/menu、README、能力表和计划。

新增依赖：无。

实现：启动前核对精确 Codex CLI `0.153.4`，重新 GET 当前 task 并比对完整任务字段 fingerprint、repo identity、checkpoint SHA、HEAD 与 clean 状态；变更字段先展示并由用户确认，再做两次临启动复查。用户需选择要发送的附件、打开预览并单独确认；prompt 限制 2 MiB，包含当前任务快照与检查点快照，标明项目数据不可信，禁止把 transcript 内命令当作可执行操作。known-secret pattern 会阻止启动（检测不保证穷尽）。

真实进程仅以 `spawn(..., shell:false)` 执行固定 argv：`codex exec --json --sandbox workspace-write --cd <当前工作区> -`，prompt 经 stdin 传入；不接受包内命令/路径，不加 `--add-dir`、`--approve-for-me` 或危险绕过参数。Attempt 只存 UUID、任务/检查点关联、开始/更新时间、workdir 本地引用、PID、Codex JSONL session ID、exit code、timeout、可靠状态；不存 prompt / transcript / tool 输出。`thread.started` 与 `turn.completed` 均存在且 exit code 0 才标 finished；进程结束但回执不完整标 `awaiting_confirmation`；扩展重启后无法核实的运行状态标 unknown 并阻止重复启动。

自动测试：`npm --prefix vscode-extension run check` 退出码 0；`npm --prefix vscode-extension test` 退出码 0（64 项）；`git diff --check` 通过。

真实 Agent 验证：Codex CLI `0.153.4` 在一次性仓库中启动 context-only 新会话，真实 `thread_id=01a0f698-7961-79c1-829a-1e3a93c2b48b`，完成 turn 并只改 `target.test.ts`；HEAD 未变、无 commit/push，`git diff --check` 通过。实测事件格式含 `thread.started`/`turn.completed`。这是 CLI/进程协议验证，不等于通过 VS Code UI 触发的扩展端到端验证。

证明材料：`tests/process-runner.test.ts`、`attempt-store.test.ts`、`launch-prompt.test.ts`；真实临时仓库仍在本机 `/tmp/agilecampus-e07-EzbNCM`，验收后可删除。

已知限制：只核验一个 CLI 版本；output channel 仅显示状态和真实 session ID，不镜像 transcript；Agent 的文件更改由 Codex workspace-write sandbox 限制在当前工作区，但这不是操作系统级进程隔离；native resume、取消、跨设备分配仍不支持。

下一单：E08 同检查点 worktree 并行探索（本次完成）；每个尝试从 checkpoint SHA 建独立分支/目录，不自动跑 setup 脚本。

## E08（同检查点并行探索）

工单 ID / 状态：E08 / 代码、临时仓库 Git 集成测试完成，纳入用户授权的整批验收；VS Code 多根工作区和双 Agent 实际操作待最终人工验收；不推送。

起点 HEAD：`6e07a3b`。

改动文件：新增 `src/git/worktree-service.ts`、`src/commands/fork-attempt.ts`、`src/commands/compare-attempts.ts` 和 Git worktree 集成测试；扩展 AttemptStore 加入并行 Attempt 元数据；接续命令可选择预建 worktree；更新命令注册、README、能力表、计划和进度。

新增依赖：无；复用已锁定 `simple-git@4.0.2`。

实现：创建并行 Attempt 前要求检查点为 clean-only、无 dirty/LFS/submodule；源仓库须 clean、repo key 匹配、checkpoint SHA 已在本地对象库中存在。通过简单 Git worktree API 从该精确 SHA 新建 host 生成的 `agilecampus/attempt-<id>` 分支和用户选择父目录下的独立目录；源工作树状态、分支和 HEAD 在创建后复核。不会联网 fetch、stash、checkout、删除目录、安装依赖、运行项目脚本、启动 Agent、自动合并或将任务标 done。每个准备中的 Attempt 可由 E07 接续命令单独启动，两个并行 Attempt 不相互锁定。

“比较并行尝试”只允许选同 checkpoint、同 base SHA 且已结束/失败的两个并行尝试；核对 Git worktree 登记、仓库身份和按 ID 生成的 branch 后，显示双方实际 HEAD、commit count、dirty 状态、变更文件和 `diff --stat`。不自动评价方案。Attempt store 为 E07 旧记录提供向前兼容映射；E04 旧检查点缺少 taskSnapshot 时会作为历史快照保留，并在接续前显示差异要求确认，不丢弃本机数据。

自动测试：`npm --prefix vscode-extension run check` 退出码 0；`npm --prefix vscode-extension test` 退出码 0（71 项）；`git diff --check` 通过。真实 Git 测试在一次性目录创建两个 worktree，从同一 SHA 分别修改同名文件，确认两个结果和源工作树互不影响；diff summary 能展示真实文件差异，并验证分支冲突生成新名称。

真实 VS Code / Agent / 跨机器验证：未通过 Extension Host 手工点击；未在实际 AgileCampus 仓库创建 worktree；并行 Agent 双跑、A/B 人工评审和跨设备未验证。

证明材料：`vscode-extension/tests/worktree-service.test.ts`、`attempt-store.test.ts`、`handoff-preflight.test.ts`。测试用的临时 Git 仓库由 Vitest 自动清理。

下一单：E09 只产出共享后端接口契约，交主线负责人评审；不能自行添加 API/schema。

## E09（共享后端契约评审）

工单 ID / 状态：E09 / 契约提案已完成，待主线和后端负责人签收；本单不改 API/schema，不推送。

起点 HEAD：`3605acd`。

改动文件：新增 `docs/reviews/vscode-checkpoint/backend-contract.md`；更新专项计划与本进度。

新增依赖：无。

核实现状：Bearer PAT 返回真人 `userId`，当前无 API scope；现有 agent project/task GET 可供扩展读取；Context Pack 创建/预览/冻结和 conversation fork route 目前使用网页登录 session；`/api/agent/runs` 代表登记的 Agent 身份，completed 会走现有提交待验收流程，不能用于报告真人启动的 Codex CLI。

提案内容：定义 actor/role 的来源、CheckpointIndex/Handoff/Attempt 逻辑模型、提议中的 `/api/extension/v1` 接口、权限矩阵、expected version + Idempotency-Key 条件写、分页/冲突/撤权/删除/留存/大小与审计边界；明确 JSON 材料第一版人工传递、服务端只存索引与 hash，不冒充已传输附件。契约逐项签收前禁止插件假定新增接口可用。

自动测试：文档核对；`git diff --check` 待本次统一验收执行。

真实 VS Code / Agent / 跨机器验证：不适用；本单无运行时接口实现。

已知限制：提案中的接口、响应、数据模型均未实现。还需产品/后端决定 PAT scope、handoff 是否改派任务、并行参与人规则、artifact 传输、删除和留存期。E10 只做现有 GET 自动刷新，不做共享写入或实时事件。

下一单：E10 已完成本地实现与自动验收；进入全量验收并交用户验收扩展宿主。

## E10（现有 GET 自动刷新与本地打包）

工单 ID / 状态：E10 / 本地代码和自动验收通过；Extension Host 手工交互、真实 PAT 和跨设备交接待最终用户验收；无后端共享写入、无发布。

起点 HEAD：`57983cc`。

改动文件：扩展新增 `src/sync/visible-refresh.ts`、对应假时钟测试、`.vscodeignore`；更新 `src/views/project-view-provider.ts`、`src/extension.ts`、README、capabilities、专项计划与进度。

新增依赖：项目无新增依赖。VSIX 用一次性 `npm exec --package @vscode/vsce` 打包，不写入扩展依赖或 lockfile。

实现：WebviewView 可见且项目已绑定时每 15 秒 GET 自动刷新；隐藏、断开或扩展释放后停止定时器。任何时刻同一刷新通道最多一个未完成请求；等待期间的手动刷新在其完成后串行执行。失败按 15/30/60 秒阶梯和 ±20% 随机抖动退避，成功复位；401 清除当前令牌并暂停自动刷新，需显式重连/刷新；403 保留错误状态并退避重试。轮询只调用现有 GET，不自动重试共享写操作。Webview visibility/message listeners 由 provider 管理并在销毁时 dispose。

自动测试命令/结果：`npm --prefix vscode-extension run check` 通过；`npm --prefix vscode-extension test` 退出码 0（13 个测试文件、76 项）；`git diff --check` 通过。真实 Git worktree 和 Codex Agent 的 E03–E08 临时仓库证据仍见各单记录。

本地打包：`vsce package --no-dependencies` 成功，生成 `/tmp/agilecampus-vscode-e10-local.vsix`（45 个文件，约 289 KB）。加入 `.vscodeignore` 排除源码、测试、开发配置；实际扩展文件和 dist 均包含。vsce 提示 package manifest 未声明 repository 且无 LICENSE 文件；没有擅自补许可证或改项目法律声明。VSIX 未安装到用户 VS Code，不代表 Extension Host 完整验收。

真实 VS Code / Agent / 跨机器验证：自动化假时钟覆盖轮询间隔、隐藏暂停、错误退避、成功复位、401 停机/人工重连、请求串行、卸载清理；尚未在 Extension Development Host 手工切换可见性/输入真实 PAT；没有双成员跨机器 API，因为后端契约待签收。

已知限制：E09 提案新增 API 没有实现；服务端仍无 checkpoint/handoff 索引写入、收件箱、artifact 传输或推送事件。E10 自动刷新现有项目/任务 GET，不是实时推送。对 403 当前保留权限错误并按退避重新 GET。

证明材料：`vscode-extension/tests/visible-refresh.test.ts`、`tests/project-view-provider.test.ts`；VSIX 列表由 vsce 打包输出核对；产物留在 `/tmp`，未加入仓库。

下一步：由主线负责人评审并签收 `backend-contract.md` 后另开后端实施单；用户在 VS Code Extension Development Host 做统一手工验收。不得把本地交接描述为已完成跨设备协同。
