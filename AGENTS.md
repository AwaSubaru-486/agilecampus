# AgileCampus 当前协作分工（先读）

> 这是共享工作区的最高优先级协作说明。开始改代码前先确认自己负责的区域；不要覆盖另一位 Agent 的未提交改动。

## 2026-10-26：网页任务记忆主路径

2026-10-27 会话收尾：结束的接续可从网页按 attemptId 定位本机会话并进入提炼审核，禁止用其他会话兜底。插件 0.1.4，见 [接续会话收尾](docs/reviews/memory-core/2026-10-27-memory-wrapup.md)。没有自动发布，也没有新增任务验收或收尾完成状态。

2026-10-27 后续：新增可选精确父版本引用，贯穿接续回执、提炼草稿、导出及网页；旧记录不补造修订号。契约和兼容边界见 [精确父记忆版本](docs/reviews/memory-core/2026-10-27-exact-parent-version.md)。新材料需要插件 0.1.3。

2026-10-27 补充：任务记忆增加明确选择基准的文字比较；网页和插件共用四项接班核对要求。使用方法和实际验证见 [接班核对与记忆比较](docs/reviews/memory-core/2026-10-27-reception-and-comparison.md)。提示要求不等于模型理解已验证；比较结果不作为任务验收或阻塞解决依据。

用户随后授权优化“需要搭手”：本轮将任务断点接入求助面板及协作中心回查。修改限于求助入口、求助上下文读取和协作中心展示，沿用原求助服务、通知和权限。见 [工作断点接入任务求助](docs/reviews/memory-core/2026-10-27-memory-help.md)。说明是人工确认的可编辑文本快照，不是强类型版本关联。

后续授权已实施第 1 批“网页与插件双向回执”：接续请求、独占领取、真实启动回调、顺序状态记录与网页恢复。契约和测试范围见 [接续回执记录](docs/reviews/memory-core/2026-10-26-continuation-receipts.md)。旧文档中的“URI 没有后续回执”仅描述上一批。真实双机接班仍待验证，模拟 API 回执不能作为真实 Agent 执行证据。

用户明确要求记忆继承在网页上可发现、可使用。本轮授权任务详情和任务对话入口、记忆专用数据库/API、网页模型上下文及 VS Code URI 桥接；不改任务状态机、账号实现、worktree 操作或全站主题。任务顶部常驻“当前工作记忆”，以保存断点、读取固定版本、继续工作串联；不能把打开插件当成启动成功。实现、迁移、测试及未验证边界见 [网页任务记忆记录](docs/reviews/memory-core/2026-10-26-web-memory-design.md)。本节覆盖下方旧阶段中“未接网页”“仅手递文件”的范围描述，其他隐私、权限和协作约束不变。用户的 `scripts/seed-tianyuan-showcase.mjs` 保持未改。

## 2026-10-25：记忆继承接入现有 Agent 启动链路

用户要求以任务记忆继承为主线，并授权开始施工。本轮在会话记忆模块之外，仅对既有 `resume-checkpoint.ts`、`handoff/launch.ts` 和 `attempts/store.ts` 做必要接线：任务级已确认记忆库、启动前核对、精确版本注入、继承来源记录、新会话记录及父记忆关联。不改 worktree Git 操作、任务状态机、账号或网页布局。前端可使用新增的 `agilecampus.continueTaskMemory` 命令并传入 taskId；接口、实际测试及剩余集成见[本轮记录](docs/reviews/memory-core/2026-10-25-memory-continuation.md)。现有两份未跟踪文件（迭代计划、天元演示 seed）必须保留。旧的“只复制上下文、不启动”仅描述旧导入步骤，不覆盖此次已授权的启动接线；真实模型及跨机器效果仍需另行实测。

## 最新个人模块入口：只做会话记忆核心（2026-10-05）

用户最新收敛范围：只负责会话采集、记忆提炼、人工修订保护和断点上下文，不负责任务管理、worktree、网页前端或账号。按[会话记忆核心 C00–C05 工单](docs/superpowers/plans/2026-10-05-memory-core-luna-workorders.md)完成全部专项；用户已授权继续执行后续批次。允许新增仅服务于会话记忆的提炼 API，复用已有鉴权和模型配置，不改账号/权限实现。旧权限、隐私、来源完整性约束继续有效；不得接管队友其他模块文件。

本节优先于下方标为旧入口、旧分工或旧阶段的历史文字。历史工单只作参考，不能覆盖 C00–C05 的当前范围；C00–C05 完成后，未经用户另行要求，不自动接手上传/账号、网页前端、任务管理或 worktree。

## 下一阶段执行入口：真实会话采集与记忆草稿（2026-10-05）

先读[真实采集、记忆草稿与交接准备 N00–N06](docs/superpowers/plans/2026-10-05-session-memory-next-luna-plan.md)。首批只执行 N00–N02，完成后停下来验收；N03–N06 是后续阶段。此前 H00–H02 的代码验收已通过，但真实 Extension Host + Codex Hook 采集、AI 提炼、私有材料发布和异机接班尚无端到端证据。仍须遵守下方 M00–M08 的权限、来源与完整性约束，不得把本机记录或页面样例说成已完成交接。

## 最新执行入口：自动会话记忆与一键发布（2026-10-02）

用户最新要求由 Codex 制定计划、Luna 施工；用户随后要求继续“干活”。先读 [自动记录会话、一键发布记忆、跨工作区接续工单](docs/superpowers/plans/2026-10-02-session-memory-publish-luna-plan.md)，按 M00–M08 顺序执行。M00 能力盘点已完成；M01 的共享事件/记忆/transcript archive 契约、数据库基础表、项目分享授权记录，以及受当前项目成员和授权版本约束的会话列表/版本索引读取已实现并通过定向测试。M02 正在施工：本机绑定与追加式事件存储基础已实现，但尚未接入 Codex/Claude Hook、扩展命令或真实 Extension Host。当前仍没有发布登记、AI 提炼、远端 transcript 上传/分页读取、网页会话页或 A→B 真实接班；不能宣称端到端已可用。详见 [会话记忆施工记录](docs/reviews/session-memory-publish/progress.md)。

本轮主线为自动采集真实 Codex 会话、AI 生成统一记忆、允许人工修订、私有记忆仓库传输、网页查看与独立 VS Code 接班。旧 R00–R03 保留复用，新工单替代旧 R04 的手递文件主路径并承接 R05；旧网页/扩展工单的首次暂停批次不再作为本轮起点。

Luna 可按本工单修改 `vscode-extension/**`、`shared/session-memory/**`、新增的会话记忆后端/schema/API、所需现有 checkpoint 接口接线、项目会话页面及其导航挂载、相关测试和文档。此授权仅限完成本轮链路；不得改任务状态机、自动验收、全站主题或无关 Agent 编排。开始先核对 dirty 改动；与其他执行者重叠时保留并协调，不能覆盖。Codex 负责最终审核。本段对下文旧分工中与上述明确范围冲突的限制优先，其余分工继续有效。

## 当前优先入口：网页交接主线（2026-10-02）

最新审核与后续工单：[检查点交接接线计划](docs/superpowers/plans/2026-10-02-handoff-integration-next-luna-plan.md)。R00–R02 已施工，结果见 [施工进度](docs/reviews/handoff-integration-next/progress.md)。R03 摘要发布由 Luna 实现；Codex 已按后端职责新增经鉴权的只读项目成员目录 API，Luna 继续负责 `vscode-extension/**` 的接收人选择与交接发送。Codex 不因此接管扩展文件。完整模型模拟测试在后续门槛通过后恢复。

用户本轮要求 **Codex 只写工单，由 Luna 施工**。执行网页重构请先读 [人–Agent 交接网页工单](docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md)，首次完成 W00–W03 的可见工作面后停下来验收。该工单对本轮网页导航、组件挂载和交付批次优先；Luna 获准修改其中列出的网页 UI/导航文件，原 Antigravity 边界不再阻挡这些具体文件。其他执行者未提交改动仍须保留，不接管 VS Code 或未签收共享后端。本文下方“首次 E00–E02”仅适用于独立扩展专项，不适用于这次网页工单。

## 用户个人模块：Luna 执行入口

[VS Code 工作台、检查点与接续专项工单](docs/superpowers/plans/2026-09-30-vscode-checkpoint-handoff-luna-workorders.md)用于用户负责的版本迭代协同模块。执行此专项时，先读该工单；其 E00–E10 顺序优先于网页执行台工单，不表示接管网页重构。首次只做 E00–E02，完成后停下来验收。

允许范围是 `vscode-extension/**` 及该专项的文档/测试。共享 schema、任务状态机、API 与网页仍由原负责人负责；E09 先提交后端契约评审，不能擅自修改共享后端。其他执行者的未提交改动必须保留。

## Codex（总负责人）

负责业务真相、权限和 AI 数据链路：

- 任务状态机与动作链：认领 → 提交成果 → 人工验收；
- 拖拽安全：状态分组不可拖拽，服务端拒绝拖拽修改 `status`；
- Context Pack：schema、preview/create/get/freeze API、权限、私密隔离、过期判断、裁剪；
- Handoff Contract：交接目标、完成条件、证据要求、响应期限、上下文包关联；
- Agent orchestrator、Agent API、数据库同步、领域测试、构建与最终合并。

Codex 维护的文件边界：

```text
src/db/schema.ts
src/lib/context-pack.ts
src/lib/handoff.ts
src/lib/task.ts
src/lib/task-status.ts
src/lib/agent/**
src/app/api/**
src/app/(app)/projects/[projectId]/actions.ts
src/app/(app)/projects/[projectId]/board.tsx
src/app/(app)/projects/[projectId]/task-card.tsx
src/app/(app)/projects/[projectId]/_work/work-space.tsx
tests/**
```

## Antigravity（视觉负责人）

负责可见 UI 的 polish、响应式和可访问性，不改变业务状态和服务端接口：

- `/today` 行动队列；
- `/library` 工程索引；
- 顶部工作带 `src/app/(app)/_shell/top-workbar.tsx`；
- 项目模式切换 `src/app/(app)/projects/[projectId]/_shared/space-tabs.tsx`；
- 现场页、记录页和协同室的 class、间距、空态、错误态、焦点状态；
- 提供桌面/窄屏截图和视觉改动说明。

Antigravity 禁止修改：

```text
schema、API route、orchestrator、task-status、任务 action、拖拽状态逻辑、测试 fixtures
```

## 共同规则

1. 从当前分支的最新 HEAD 开始工作，不回退到旧提交。本轮网页重构先读 [`2026-10-02 交接主线工单`](docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md)，以其导航、挂载和批次要求为准；[`2026-09-30 逐单施工手册`](docs/superpowers/plans/2026-09-30-collaboration-console-execution-runbook.md)与[`产品与架构计划`](docs/superpowers/plans/2026-09-30-human-agent-collaboration-console-rebuild.md)保留领域语义和权限约束。2026-09-29 文案规则继续有效；2026-09-28 双端计划保留为长期规划。本页顶部已明确授权的网页文件可由 Luna 修改，其余跨边界修改仍须协调。
2. 一次只改自己负责的文件；跨边界前先说明，不直接覆盖。
3. 每项独立提交：`feat(ui): ...`、`fix(core): ...` 或 `docs: ...`。
4. 禁止 `git reset --hard`、删除测试、覆盖未提交改动。
5. Codex 负责最终合并以及 `npm run lint`、`npm run build`、相关 Vitest 验收。

详细说明：`docs/reviews/2026-09-20-agent-work-split.md`。
